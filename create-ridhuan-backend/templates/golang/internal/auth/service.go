package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"time"

	"database/sql"
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db/projection"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
	"github.com/RidhuanDEV/golang-backend/internal/model"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const accessTokenTTL = 15 * time.Minute
const refreshTokenTTL = 30 * 24 * time.Hour

// Unknown emails still pay one bcrypt comparison so response time does not reveal which accounts exist.
var dummyPasswordHash = sync.OnceValue(func() []byte {
	secret := make([]byte, 16)
	_, _ = rand.Read(secret)
	hash, _ := bcrypt.GenerateFromPassword(secret, 12)
	return hash
})

type Actor = audit.Actor
type Claims struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	RoleID   string `json:"roleId"`
	TokenUse string `json:"tokenUse"`
	jwt.RegisteredClaims
}
type Service struct {
	Queries          sqlc.Querier
	Audit            *audit.Writer
	Secret           []byte
	Issuer, Audience string
}

func (s *Service) Register(ctx context.Context, p audit.Policy, b model.Credentials) (model.AuthUser, error) {
	if err := fault.Email(b.Email); err != nil {
		return model.AuthUser{}, err
	}
	if len(b.Password) < 6 || len(b.Password) > 72 {
		return model.AuthUser{}, fault.New(fault.Invalid, "Password must contain 6-72 bytes")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(b.Password), 12)
	if err != nil {
		return model.AuthUser{}, fault.DB(err)
	}
	return audit.Mutate(ctx, s.Audit, p, nil, "CREATE", func(q sqlc.Querier) (model.AuthUser, audit.Change, error) {
		r, err := q.FindRoleByName(ctx, "user")
		if err != nil {
			return model.AuthUser{}, audit.Change{}, fault.DB(err)
		}
		row, err := q.CreateUser(ctx, sqlc.CreateUserParams{Lower: b.Email, Password: string(hash), RoleID: r.ID})
		if err != nil {
			return model.AuthUser{}, audit.Change{}, fault.DB(err)
		}
		out := projection.AuthUser(row)
		change, err := audit.Capture(out.ID, (*model.AuthUser)(nil), &out)
		return out, change, err
	})
}
func (s *Service) Login(ctx context.Context, p audit.Policy, b model.Credentials) (model.TokenPair, error) {
	row, err := s.Queries.FindActiveUserByEmail(ctx, strings.ToLower(b.Email))
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return model.TokenPair{}, fault.DB(err)
		}
		_ = bcrypt.CompareHashAndPassword(dummyPasswordHash(), []byte(b.Password))
		return model.TokenPair{}, fault.New(fault.Unauthorized, "Invalid credentials")
	}
	if bcrypt.CompareHashAndPassword([]byte(row.Password), []byte(b.Password)) != nil {
		return model.TokenPair{}, fault.New(fault.Unauthorized, "Invalid credentials")
	}
	actor := &Actor{ID: row.ID, Email: row.Email, RoleID: row.RoleID}
	return audit.Mutate(ctx, s.Audit, p, actor, "LOGIN", func(q sqlc.Querier) (model.TokenPair, audit.Change, error) {
		// Keep consumed hashes until the family is retained by cleanup.
		pair, tokenHash, familyID, err := s.issueTokenPair(row.ID, row.Email, row.RoleID, "", time.Now().UTC().Add(refreshTokenTTL))
		if err != nil {
			return model.TokenPair{}, audit.Change{}, err
		}
		if err = q.CreateRefreshFamily(ctx, sqlc.CreateRefreshFamilyParams{ID: familyID, UserID: row.ID, ExpiresAt: sql.NullTime{Time: pair.RefreshTokenExpiresAt, Valid: true}}); err != nil {
			return model.TokenPair{}, audit.Change{}, err
		}
		err = q.CreateAuthRefreshToken(ctx, sqlc.CreateAuthRefreshTokenParams{FamilyID: familyID, UserID: row.ID, TokenHash: tokenHash, ExpiresAt: sql.NullTime{Time: pair.RefreshTokenExpiresAt, Valid: true}})
		return pair, audit.Change{EntityID: row.ID}, err
	})
}

func (s *Service) issueTokenPair(userID, email, roleID, familyID string, refreshExpiresAt time.Time) (model.TokenPair, []byte, string, error) {
	if familyID == "" {
		familyID = uuid.NewString()
	}
	refreshBytes := make([]byte, 32)
	if _, err := rand.Read(refreshBytes); err != nil {
		return model.TokenPair{}, nil, "", err
	}
	refreshToken := base64.RawURLEncoding.EncodeToString(refreshBytes)
	hash := sha256.Sum256([]byte(refreshToken))
	now := time.Now().UTC()
	claims := Claims{ID: userID, Email: email, RoleID: roleID, TokenUse: "access", RegisteredClaims: jwt.RegisteredClaims{Issuer: s.Issuer, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(accessTokenTTL))}}
	if s.Audience != "" {
		claims.Audience = jwt.ClaimStrings{s.Audience}
	}
	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.Secret)
	if err != nil {
		return model.TokenPair{}, nil, "", err
	}
	return model.TokenPair{AccessToken: accessToken, RefreshToken: refreshToken, AccessTokenExpiresIn: int64(accessTokenTTL.Seconds()), RefreshTokenExpiresAt: refreshExpiresAt.UTC()}, hash[:], familyID, nil
}

type sessionSnapshot struct {
	ExpiresAt time.Time `json:"expiresAt"`
	Revoked   bool      `json:"revoked"`
}

func (s *Service) Refresh(ctx context.Context, p audit.Policy, raw string) (model.TokenPair, error) {
	hash := sha256.Sum256([]byte(raw))
	lookup, err := s.Queries.LookupAuthRefreshToken(ctx, hash[:])
	if errors.Is(err, sql.ErrNoRows) {
		return model.TokenPair{}, fault.New(fault.Unauthorized, "Invalid refresh token")
	}
	if err != nil {
		return model.TokenPair{}, fault.DB(err)
	}
	var pair model.TokenPair
	var actor *Actor
	invalid := false
	mutated := false
	change := audit.Change{}
	behavior := "TOKEN_REFRESH"
	err = s.Audit.Pool.Transaction(ctx, func(q sqlc.Querier) error {
		family, err := q.LockRefreshFamily(ctx, lookup.FamilyID)
		if errors.Is(err, sql.ErrNoRows) {
			invalid = true
			return nil
		}
		if err != nil {
			return err
		}
		stored, err := q.FindAuthRefreshTokenByHash(ctx, hash[:])
		if err != nil {
			return err
		}
		user, err := q.FindActiveUserByID(ctx, family.UserID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		active := err == nil
		if active {
			actor = &Actor{ID: user.ID, Email: user.Email, RoleID: user.RoleID}
		}
		now := time.Now().UTC()
		before := sessionSnapshot{family.ExpiresAt.Time.UTC(), family.RevokedAt.Valid}
		after := before
		if family.RevokedAt.Valid || !family.ExpiresAt.Time.After(now) || stored.RevokedAt.Valid || !stored.ExpiresAt.Time.After(now) || !active {
			invalid = true
			behavior = "REFRESH_REPLAY"
			after.Revoked = true
			if err = q.RevokeRefreshFamilyRecord(ctx, family.ID); err != nil {
				return err
			}
			if err = q.RevokeAuthRefreshFamily(ctx, family.ID); err != nil {
				return err
			}
		} else {
			expires := sql.NullTime{Time: now.Add(refreshTokenTTL), Valid: true}
			after.ExpiresAt = expires.Time
			var tokenHash []byte
			pair, tokenHash, _, err = s.issueTokenPair(user.ID, user.Email, user.RoleID, family.ID, expires.Time)
			if err != nil {
				return err
			}
			if _, err = q.RevokeAuthRefreshToken(ctx, stored.ID); err != nil {
				return err
			}
			if err = q.AdvanceRefreshFamily(ctx, sqlc.AdvanceRefreshFamilyParams{ID: family.ID, ExpiresAt: expires}); err != nil {
				return err
			}
			if err = q.CreateAuthRefreshToken(ctx, sqlc.CreateAuthRefreshTokenParams{FamilyID: family.ID, UserID: user.ID, TokenHash: tokenHash, ExpiresAt: expires}); err != nil {
				return err
			}
		}
		change, err = audit.Capture(family.ID, &before, &after)
		if err != nil {
			return err
		}
		mutated = true
		if p.Mode == audit.Required {
			return s.Audit.Write(ctx, q, p, actor, behavior, change)
		}
		return nil
	})
	if err != nil {
		return model.TokenPair{}, fault.DB(err)
	}
	if mutated && p.Mode == audit.Optional {
		s.optionalSessionAudit(ctx, p, actor, behavior, change)
	}
	if invalid {
		return model.TokenPair{}, fault.New(fault.Unauthorized, "Invalid or expired refresh token")
	}
	return pair, nil
}
func (s *Service) Logout(ctx context.Context, p audit.Policy, raw string) error {
	hash := sha256.Sum256([]byte(raw))
	lookup, err := s.Queries.LookupAuthRefreshToken(ctx, hash[:])
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fault.DB(err)
	}
	changed := false
	change := audit.Change{}
	var actor *Actor
	err = s.Audit.Pool.Transaction(ctx, func(q sqlc.Querier) error {
		family, err := q.LockRefreshFamily(ctx, lookup.FamilyID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if family.RevokedAt.Valid {
			return nil
		}
		user, err := q.FindActiveUserByID(ctx, family.UserID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err == nil {
			actor = &Actor{ID: user.ID, Email: user.Email, RoleID: user.RoleID}
		}
		if err = q.RevokeRefreshFamilyRecord(ctx, family.ID); err != nil {
			return err
		}
		if err = q.RevokeAuthRefreshFamily(ctx, family.ID); err != nil {
			return err
		}
		before := sessionSnapshot{family.ExpiresAt.Time.UTC(), false}
		after := sessionSnapshot{family.ExpiresAt.Time.UTC(), true}
		change, err = audit.Capture(family.ID, &before, &after)
		if err != nil {
			return err
		}
		changed = true
		if p.Mode == audit.Required {
			return s.Audit.Write(ctx, q, p, actor, "LOGOUT", change)
		}
		return nil
	})
	if err != nil {
		return fault.DB(err)
	}
	if changed && p.Mode == audit.Optional {
		s.optionalSessionAudit(ctx, p, actor, "LOGOUT", change)
	}
	return nil
}
func (s *Service) optionalSessionAudit(ctx context.Context, p audit.Policy, actor *Actor, behavior string, change audit.Change) {
	detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if err := s.Audit.Write(detached, s.Queries, p, actor, behavior, change); err != nil {
		s.Audit.Log.Warn("optional session audit failed", "endpoint", p.ID)
	}
}
func (s *Service) Authenticate(ctx context.Context, raw string) (*Actor, error) {
	deny := func() (*Actor, error) { return nil, fault.New(fault.Unauthorized, "Unauthorized") }
	if !strings.HasPrefix(raw, "Bearer ") {
		return deny()
	}
	claims := new(Claims)
	options := []jwt.ParserOption{jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired()}
	if s.Issuer != "" {
		options = append(options, jwt.WithIssuer(s.Issuer))
	}
	if s.Audience != "" {
		options = append(options, jwt.WithAudience(s.Audience))
	}
	token, err := jwt.ParseWithClaims(strings.TrimPrefix(raw, "Bearer "), claims, func(*jwt.Token) (any, error) { return s.Secret, nil }, options...)
	if err != nil || !token.Valid || claims.TokenUse != "access" || fault.UUID(claims.ID) != nil {
		return deny()
	}
	row, err := s.Queries.FindActiveUserByID(ctx, claims.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return deny()
		}
		return nil, fault.DB(err)
	}
	return &Actor{ID: row.ID, Email: row.Email, RoleID: row.RoleID, ExpiresAt: claims.ExpiresAt.Time}, nil
}
func (s *Service) Authorize(ctx context.Context, actor *Actor, permission string) error {
	if permission == "" {
		return nil
	}
	allowed, err := s.Queries.UserHasPermission(ctx, sqlc.UserHasPermissionParams{ID: actor.ID, Name: permission})
	if err != nil {
		return fault.DB(err)
	}
	if !allowed {
		return fault.New(fault.Forbidden, "Forbidden")
	}
	return nil
}
func (s *Service) Me(ctx context.Context, actor *Actor) (model.AuthUser, error) {
	r, err := s.Queries.FindUser(ctx, actor.ID)
	return projection.AuthUser(r), fault.DB(err)
}
