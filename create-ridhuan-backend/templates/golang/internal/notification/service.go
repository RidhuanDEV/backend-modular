package notification

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	mail "github.com/wneessen/go-mail"
)

type Item struct {
	ID          string     `json:"id" format:"uuid"`
	RecipientID string     `json:"recipientId" format:"uuid"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	EmailStatus string     `json:"emailStatus"`
	ReadAt      *time.Time `json:"readAt"`
	CreatedAt   time.Time  `json:"createdAt"`
}
type CreateInput struct {
	RecipientID string `json:"recipientId" format:"uuid"`
	Title       string `json:"title" minLength:"1" maxLength:"160"`
	Body        string `json:"body" minLength:"1" maxLength:"4000"`
	SendEmail   bool   `json:"sendEmail"`
}
type Service struct {
	Pool  *pgxpool.Pool
	Audit *audit.Writer
	SMTP  config.Config
}

var ErrRecipient = errors.New("recipient not found")
var ErrItem = errors.New("notification not found")
var ErrInvalid = errors.New("invalid notification")

func scan(row pgx.Row) (Item, error) {
	var value Item
	err := row.Scan(&value.ID, &value.RecipientID, &value.Title, &value.Body, &value.EmailStatus, &value.ReadAt, &value.CreatedAt)
	return value, err
}

const projection = `id, recipient_id, title, body, email_status, read_at, created_at`

func (s *Service) Create(ctx context.Context, policy audit.Policy, actor *audit.Actor, input CreateInput) (Item, error) {
	var value Item
	if strings.TrimSpace(input.Title) == "" || strings.TrimSpace(input.Body) == "" || len(input.Title) > 160 || len(input.Body) > 4000 {
		return value, ErrInvalid
	}
	var email string
	err := s.Pool.QueryRow(ctx, `SELECT email FROM users WHERE id=$1 AND deleted_at IS NULL`, input.RecipientID).Scan(&email)
	if errors.Is(err, pgx.ErrNoRows) {
		return value, ErrRecipient
	}
	if err != nil {
		return value, err
	}
	status := "NOT_REQUESTED"
	if input.SendEmail {
		status = "PENDING"
	}
	var change audit.Change
	err = db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		var e error
		value, e = scan(tx.QueryRow(ctx, `INSERT INTO notifications(recipient_id, actor_id, title, body, email_status)
   VALUES($1,$2,$3,$4,$5) RETURNING `+projection, input.RecipientID, actor.ID, strings.TrimSpace(input.Title), strings.TrimSpace(input.Body), status))
		if e != nil {
			return e
		}
		after, e := json.Marshal(struct {
			ID             string `json:"id"`
			RecipientID    string `json:"recipientId"`
			Title          string `json:"title"`
			EmailRequested bool   `json:"emailRequested"`
		}{value.ID, value.RecipientID, value.Title, input.SendEmail})
		if e != nil {
			return e
		}
		change = audit.Change{EntityID: value.ID, After: after}
		if policy.Mode == audit.Required {
			return s.Audit.Write(ctx, sqlc.New(s.Pool).WithTx(tx), policy, actor, "CREATE", change)
		}
		return nil
	})
	if err != nil {
		return Item{}, err
	}
	if policy.Mode == audit.Optional {
		if e := s.Audit.Write(ctx, sqlc.New(s.Pool), policy, actor, "CREATE", change); e != nil {
			s.Audit.Log.Warn("optional notification audit failed", "error", e)
		}
	}
	if !input.SendEmail {
		return value, nil
	}
	status = "FAILED"
	if s.SMTP.SMTPEnabled && s.send(ctx, email, input.Title, input.Body) == nil {
		status = "SENT"
	}
	return scan(s.Pool.QueryRow(ctx, `UPDATE notifications SET email_status=$2 WHERE id=$1 RETURNING `+projection, value.ID, status))
}

func (s *Service) send(ctx context.Context, to, title, body string) error {
	options := []mail.Option{mail.WithPort(s.SMTP.SMTPPort)}
	if s.SMTP.SMTPSecure {
		options = append(options, mail.WithSSL())
	} else {
		options = append(options, mail.WithTLSPolicy(mail.TLSMandatory))
	}
	if s.SMTP.SMTPUser != "" {
		options = append(options, mail.WithSMTPAuth(mail.SMTPAuthPlain), mail.WithUsername(s.SMTP.SMTPUser), mail.WithPassword(s.SMTP.SMTPPassword))
	}
	client, err := mail.NewClient(s.SMTP.SMTPHost, options...)
	if err != nil {
		return err
	}
	message := mail.NewMsg()
	if err = message.From(s.SMTP.SMTPFrom); err != nil {
		return err
	}
	if err = message.To(to); err != nil {
		return err
	}
	message.Subject(title)
	message.SetBodyString(mail.TypeTextPlain, body)
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return client.DialAndSendWithContext(bounded, message)
}

func (s *Service) List(ctx context.Context, recipient string, unread bool) ([]Item, error) {
	query := `SELECT ` + projection + ` FROM notifications WHERE recipient_id=$1`
	if unread {
		query += ` AND read_at IS NULL`
	}
	query += ` ORDER BY created_at DESC, id DESC LIMIT 50`
	rows, err := s.Pool.Query(ctx, query, recipient)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Item, 0)
	for rows.Next() {
		value, e := scan(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, value)
	}
	return items, rows.Err()
}

func (s *Service) Read(ctx context.Context, policy audit.Policy, actor *audit.Actor, id string) (Item, error) {
	var value Item
	var change audit.Change
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		prior, e := scan(tx.QueryRow(ctx, `SELECT `+projection+` FROM notifications WHERE id=$1 AND recipient_id=$2 FOR UPDATE`, id, actor.ID))
		if errors.Is(e, pgx.ErrNoRows) {
			return ErrItem
		}
		if e != nil {
			return e
		}
		value, e = scan(tx.QueryRow(ctx, `UPDATE notifications SET read_at=coalesce(read_at, now()) WHERE id=$1 RETURNING `+projection, id))
		if e != nil {
			return e
		}
		before, e := json.Marshal(struct {
			ReadAt *time.Time `json:"readAt"`
		}{prior.ReadAt})
		if e != nil {
			return e
		}
		after, e := json.Marshal(struct {
			ReadAt *time.Time `json:"readAt"`
		}{value.ReadAt})
		if e != nil {
			return e
		}
		change = audit.Change{EntityID: id, Before: before, After: after}
		if policy.Mode == audit.Required {
			return s.Audit.Write(ctx, sqlc.New(s.Pool).WithTx(tx), policy, actor, "UPDATE", change)
		}
		return nil
	})
	if err != nil {
		return Item{}, err
	}
	if policy.Mode == audit.Optional {
		if e := s.Audit.Write(ctx, sqlc.New(s.Pool), policy, actor, "UPDATE", change); e != nil {
			s.Audit.Log.Warn("optional notification audit failed", "error", e)
		}
	}
	return value, nil
}
