package fault

import (
	"errors"
	"github.com/jackc/pgx/v5/pgconn"
	"testing"
)

func TestPostgresConstraintClassification(t *testing.T) {
	for _, code := range []string{"23503", "23001"} {
		var mapped *Error
		if !errors.As(DB(&pgconn.PgError{Code: code}), &mapped) || mapped.Kind != Invalid {
			t.Fatal("wrong constraint mapping", code)
		}
	}
	original := New(Forbidden, "denied")
	if DB(original) != original {
		t.Fatal("domain error overwritten")
	}
}
