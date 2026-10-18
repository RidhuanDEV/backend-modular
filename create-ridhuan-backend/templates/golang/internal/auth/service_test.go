package auth

import (
	"context"
	"errors"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestJWTBoundariesRejectBeforeDatabase(t *testing.T) {
	s := &Service{Secret: []byte("a_very_long_testing_secret_32_bytes"), Issuer: "template", Audience: "clients"}
	base := Claims{ID: uuid.NewString(), RegisteredClaims: jwt.RegisteredClaims{Issuer: "template", Audience: jwt.ClaimStrings{"clients"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}
	for _, name := range []string{"signature", "algorithm", "issuer", "audience", "expired", "missing_expiry", "invalid_id"} {
		t.Run(name, func(t *testing.T) {
			claims := base
			method := jwt.SigningMethodHS256
			key := s.Secret
			switch name {
			case "signature":
				key = []byte("other_secret")
			case "algorithm":
				method = jwt.SigningMethodHS384
			case "issuer":
				claims.Issuer = "other"
			case "audience":
				claims.Audience = jwt.ClaimStrings{"other"}
			case "expired":
				claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute))
			case "missing_expiry":
				claims.ExpiresAt = nil
			case "invalid_id":
				claims.ID = "bad"
			}
			token, err := jwt.NewWithClaims(method, claims).SignedString(key)
			if err != nil {
				t.Fatal(err)
			}
			actor, err := s.Authenticate(context.Background(), "Bearer "+token)
			var f *fault.Error
			if actor != nil || !errors.As(err, &f) || f.Kind != fault.Unauthorized {
				t.Fatal("invalid JWT accepted", actor, err)
			}
		})
	}
}

func TestIdleExpiryNeverPassesFamilyExpiry(t *testing.T) {
	s := &Service{RefreshIdle: 30 * 24 * time.Hour, RefreshAbsolute: 90 * 24 * time.Hour}
	login := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	family := login.Add(s.RefreshAbsolute)
	if got := s.idleExpiry(login, family); !got.Equal(login.Add(s.RefreshIdle)) {
		t.Fatalf("early rotation expiry %v", got)
	}
	if got := s.idleExpiry(login.Add(80*24*time.Hour), family); !got.Equal(family) {
		t.Fatalf("late rotation expiry %v, want family %v", got, family)
	}
}
