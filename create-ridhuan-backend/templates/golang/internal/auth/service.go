package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/db/projection"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
	"github.com/RidhuanDEV/golang-backend/internal/model"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

const accessTokenTTL = 15 * time.Minute
const refreshTokenTTL = 30 * 24 * time.Hour

type Actor = audit.Actor
type Claims struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	RoleID   string `json:"roleId"`
	TokenUse string `json:"tokenUse"`
	jwt.RegisteredClaims
}
type Service struct {
	Queries          *sqlc.Queries
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
	return audit.Mutate(ctx, s.Audit, p, nil, "CREATE", func(q *sqlc.Queries) (model.AuthUser, audit.Change, error) {
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
		if !errors.Is(err, pgx.ErrNoRows) {
			return model.TokenPair{}, fault.DB(err)
		}
		return model.TokenPair{}, fault.New(fault.Unauthorized, "Invalid credentials")
	}
	if bcrypt.CompareHashAndPassword([]byte(row.Password), []byte(b.Password)) != nil {
		return model.TokenPair{}, fault.New(fault.Unauthorized, "Invalid credentials")
	}
	actor := &Actor{ID: row.ID, Email: row.Email, RoleID: row.RoleID}
	return audit.Mutate(ctx, s.Audit, p, actor, "LOGIN", func(q *sqlc.Queries) (model.TokenPair, audit.Change, error) {
		pair, tokenHash, familyID, err := s.issueTokenPair(row.ID, row.Email, row.RoleID, "", time.Now().UTC().Add(refreshTokenTTL))
		if err != nil {
			return model.TokenPair{}, audit.Change{}, err
		}
		err = q.CreateAuthRefreshToken(ctx, sqlc.CreateAuthRefreshTokenParams{FamilyID: familyID, UserID: row.ID, TokenHash: tokenHash, ExpiresAt: pgtype.Timestamptz{Time: pair.RefreshTokenExpiresAt, Valid: true}})
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

func (s *Service) Refresh(ctx context.Context, p audit.Policy, rawRefreshToken string) (model.TokenPair, error) {
	if rawRefreshToken == "" {
		return model.TokenPair{}, fault.New(fault.Unauthorized, "Invalid refresh token")
	}
	hash := sha256.Sum256([]byte(rawRefreshToken))
	var pair model.TokenPair
	var actor *Actor
	var entityID string
	invalid := false
	err := db.InTx(ctx, s.Audit.Pool, func(tx pgx.Tx) error {
		q := s.Queries.WithTx(tx)
		stored, err := q.FindAuthRefreshTokenByHash(ctx, hash[:])
		if errors.Is(err, pgx.ErrNoRows) {
			invalid = true
			return nil
		}
		if err != nil {
			return err
		}
		entityID = stored.UserID
		if stored.RevokedAt.Valid {
			if err = q.RevokeAuthRefreshFamily(ctx, stored.FamilyID); err != nil {
				return err
			}
			invalid = true
			if p.Mode == audit.Required {
				return s.Audit.Write(ctx, q, p, nil, "REFRESH_REPLAY", audit.Change{EntityID: stored.FamilyID})
			}
			return nil
		}
		if !stored.ExpiresAt.Valid || !stored.ExpiresAt.Time.After(time.Now().UTC()) {
			if err = q.RevokeAuthRefreshFamily(ctx, stored.FamilyID); err != nil {
				return err
			}
			invalid = true
			return nil
		}
		user, err := q.FindActiveUserByID(ctx, stored.UserID)
		if errors.Is(err, pgx.ErrNoRows) {
			if err = q.RevokeAuthRefreshFamily(ctx, stored.FamilyID); err != nil {
				return err
			}
			invalid = true
			return nil
		}
		if err != nil {
			return err
		}
		actor = &Actor{ID: user.ID, Email: user.Email, RoleID: user.RoleID}
		var tokenHash []byte
		pair, tokenHash, _, err = s.issueTokenPair(user.ID, user.Email, user.RoleID, stored.FamilyID, stored.ExpiresAt.Time)
		if err != nil {
			return err
		}
		affected, err := q.RevokeAuthRefreshToken(ctx, stored.ID)
		if err != nil {
			return err
		}
		if affected != 1 {
			return errors.New("refresh token was already consumed")
		}
		if err = q.CreateAuthRefreshToken(ctx, sqlc.CreateAuthRefreshTokenParams{FamilyID: stored.FamilyID, UserID: user.ID, TokenHash: tokenHash, ExpiresAt: stored.ExpiresAt}); err != nil {
			return err
		}
		if p.Mode == audit.Required {
			return s.Audit.Write(ctx, q, p, actor, "TOKEN_REFRESH", audit.Change{EntityID: user.ID})
		}
		return nil
	})
	if err != nil {
		return model.TokenPair{}, fault.DB(err)
	}
	if invalid {
		return model.TokenPair{}, fault.New(fault.Unauthorized, "Invalid refresh token")
	}
	if p.Mode == audit.Optional {
		detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer cancel()
		if err = s.Audit.Write(detached, s.Queries, p, actor, "TOKEN_REFRESH", audit.Change{EntityID: entityID}); err != nil {
			s.Audit.Log.Warn("optional refresh audit failed", "endpoint", p.ID, "error", err)
		}
	}
	return pair, nil
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
		if errors.Is(err, pgx.ErrNoRows) {
			return deny()
		}
		return nil, fault.DB(err)
	}
	return &Actor{ID: row.ID, Email: row.Email, RoleID: row.RoleID}, nil
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
