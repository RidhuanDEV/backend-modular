package fault

import (
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"regexp"
	"strings"
	"unicode/utf8"
)

type Kind string

const (
	Invalid      Kind = "invalid"
	Missing      Kind = "missing"
	Duplicate    Kind = "duplicate"
	Unauthorized Kind = "unauthorized"
	Forbidden    Kind = "forbidden"
	Internal     Kind = "internal"
	TooLarge     Kind = "too_large"
	Unavailable  Kind = "unavailable"
)

type Error struct {
	Kind    Kind
	Message string
	Cause   error
}

func (e *Error) Error() string            { return e.Message }
func (e *Error) Unwrap() error            { return e.Cause }
func New(kind Kind, message string) error { return &Error{Kind: kind, Message: message} }
func DB(err error) error {
	if err == nil {
		return nil
	}
	var known *Error
	if errors.As(err, &known) {
		return err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return New(Missing, "Not found")
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "23505":
			return New(Duplicate, "Record already exists")
		case "23503", "23001":
			return New(Invalid, "Referenced record does not exist or is in use")
		case "40001", "40P01":
			return New(Duplicate, "Concurrent change; retry the request")
		}
	}
	return &Error{Kind: Internal, Message: "Internal server error", Cause: err}
}
func UUID(value string) error {
	if _, err := uuid.Parse(value); err != nil {
		return New(Invalid, "Invalid UUID")
	}
	return nil
}

var emailRE = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func Email(value string) error {
	if !emailRE.MatchString(value) || len(value) > 320 {
		return New(Invalid, "Invalid email address")
	}
	return nil
}
func Name(value string, max int) error {
	if strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > max {
		return New(Invalid, fmt.Sprintf("name must contain 1-%d characters", max))
	}
	return nil
}
