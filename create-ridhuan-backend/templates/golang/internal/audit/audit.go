package audit

import (
	"context"
	"encoding/json"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"strings"
	"time"
)

type Mode string

const (
	Required Mode = "required"
	Optional Mode = "optional"
	None     Mode = "none"
)

type Actor struct{ ID, Email, RoleID string }
type Policy struct {
	ID, Module, RequestID string
	Mode                  Mode
}
type Change struct {
	EntityID      string
	Before, After json.RawMessage
}
type Writer struct {
	Pool *pgxpool.Pool
	Log  *slog.Logger
}

// Capture accepts typed projections. Raw messages are the storage boundary, never domain inputs.
func Capture[T any](id string, before, after *T) (Change, error) {
	change := Change{EntityID: id}
	var err error
	if before != nil {
		change.Before, err = json.Marshal(before)
		if err != nil {
			return change, err
		}
	}
	if after != nil {
		change.After, err = json.Marshal(after)
		if err != nil {
			return change, err
		}
	}
	change.Before, err = redact(change.Before)
	if err != nil {
		return change, err
	}
	change.After, err = redact(change.After)
	return change, err
}
func redact(raw json.RawMessage) (json.RawMessage, error) {
	if raw == nil {
		return nil, nil
	}
	var object map[string]json.RawMessage
	if len(raw) > 0 && raw[0] == '{' {
		if err := json.Unmarshal(raw, &object); err != nil {
			return nil, err
		}
		for key, value := range object {
			switch strings.ToLower(key) {
			case "password", "passwordhash", "password_hash", "hash", "token", "accesstoken", "access_token", "refreshtoken", "refresh_token", "secret", "secretkey", "credential", "credentials", "authorization":
				delete(object, key)
			default:
				clean, err := redact(value)
				if err != nil {
					return nil, err
				}
				object[key] = clean
			}
		}
		return json.Marshal(object)
	}
	if len(raw) > 0 && raw[0] == '[' {
		var values []json.RawMessage
		if err := json.Unmarshal(raw, &values); err != nil {
			return nil, err
		}
		for i, value := range values {
			clean, err := redact(value)
			if err != nil {
				return nil, err
			}
			values[i] = clean
		}
		return json.Marshal(values)
	}
	return raw, nil
}
func text(value string) pgtype.Text { return pgtype.Text{String: value, Valid: value != ""} }
func (w *Writer) Write(ctx context.Context, q *sqlc.Queries, p Policy, actor *Actor, behavior string, c Change) error {
	if p.Mode == None {
		return nil
	}
	var userID *string
	var snapshot string
	if actor != nil {
		value := actor.ID
		userID = &value
		snapshot = value
	}
	if p.ID == "auth.register" {
		value := c.EntityID
		userID = &value
		snapshot = value
		p.Module = "user"
		behavior = "REGISTER"
	}
	return q.InsertAudit(ctx, sqlc.InsertAuditParams{Behavior: behavior, Module: p.Module, EntityID: text(c.EntityID), UserID: userID, ActorIDSnapshot: text(snapshot), Before: c.Before, After: c.After, RequestID: text(p.RequestID), EndpointID: text(p.ID)})
}
func Mutate[T any](ctx context.Context, w *Writer, p Policy, actor *Actor, behavior string, fn func(*sqlc.Queries) (T, Change, error)) (T, error) {
	var result T
	var change Change
	err := db.InTx(ctx, w.Pool, func(tx pgx.Tx) error {
		var err error
		result, change, err = fn(sqlc.New(w.Pool).WithTx(tx))
		if err != nil {
			return err
		}
		if p.Mode == Required {
			return w.Write(ctx, sqlc.New(w.Pool).WithTx(tx), p, actor, behavior, change)
		}
		return nil
	})
	if err != nil {
		var zero T
		return zero, fault.DB(err)
	}
	if p.Mode == Optional {
		detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer cancel()
		if err = w.Write(detached, sqlc.New(w.Pool), p, actor, behavior, change); err != nil {
			w.Log.Warn("optional audit failed", "endpoint", p.ID, "error", err)
		}
	}
	return result, nil
}
func (w *Writer) Read(ctx context.Context, p Policy, actor *Actor, id string) {
	if p.Mode != Optional {
		return
	}
	payload := struct {
		Endpoint string `json:"endpoint"`
	}{p.ID}
	change, err := Capture(id, (*struct {
		Endpoint string `json:"endpoint"`
	})(nil), &payload)
	if err == nil {
		detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer cancel()
		err = w.Write(detached, sqlc.New(w.Pool), p, actor, "READ", change)
	}
	if err != nil {
		w.Log.Warn("optional read audit failed", "endpoint", p.ID, "error", err)
	}
}
