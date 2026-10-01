package notification

import (
	"context"
	"database/sql"
	"errors"
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/google/uuid"
	mail "github.com/wneessen/go-mail"
	"strings"
	"time"
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
	Pool  db.Connection
	Audit *audit.Writer
	SMTP  config.Config
}

var ErrRecipient = errors.New("recipient not found")
var ErrItem = errors.New("notification not found")
var ErrInvalid = errors.New("invalid notification")

func project(row sqlc.Notification) Item {
	var read *time.Time
	if row.ReadAt.Valid {
		value := row.ReadAt.Time.UTC()
		read = &value
	}
	return Item{ID: row.ID, RecipientID: row.RecipientID, Title: row.Title, Body: row.Body, EmailStatus: row.EmailStatus, ReadAt: read, CreatedAt: row.CreatedAt.Time.UTC()}
}
func (s *Service) Create(ctx context.Context, policy audit.Policy, actor *audit.Actor, input CreateInput) (Item, error) {
	if strings.TrimSpace(input.Title) == "" || strings.TrimSpace(input.Body) == "" || len(input.Title) > 160 || len(input.Body) > 4000 {
		return Item{}, ErrInvalid
	}
	recipient, err := s.Pool.Queries().FindActiveUserByID(ctx, input.RecipientID)
	if errors.Is(err, sql.ErrNoRows) {
		return Item{}, ErrRecipient
	}
	if err != nil {
		return Item{}, err
	}
	status := "NOT_REQUESTED"
	if input.SendEmail {
		status = "PENDING"
	}
	value, err := audit.Mutate(ctx, s.Audit, policy, actor, "CREATE", func(q sqlc.Querier) (Item, audit.Change, error) {
		id := uuid.NewString()
		err := q.CreateNotification(ctx, sqlc.CreateNotificationParams{ID: id, RecipientID: input.RecipientID, ActorID: &actor.ID, Title: strings.TrimSpace(input.Title), Body: strings.TrimSpace(input.Body), EmailStatus: status})
		if err != nil {
			return Item{}, audit.Change{}, err
		}
		row, err := q.FindNotification(ctx, id)
		if err != nil {
			return Item{}, audit.Change{}, err
		}
		value := project(row)
		change, err := audit.Capture(id, (*Item)(nil), &value)
		return value, change, err
	})
	if err != nil || !input.SendEmail {
		return value, err
	}
	status = "FAILED"
	if s.SMTP.SMTPEnabled && s.send(ctx, recipient.Email, input.Title, input.Body) == nil {
		status = "SENT"
	}
	if err = s.Pool.Queries().SetNotificationEmailStatus(ctx, sqlc.SetNotificationEmailStatusParams{ID: value.ID, EmailStatus: status}); err != nil {
		return Item{}, err
	}
	row, err := s.Pool.Queries().FindNotification(ctx, value.ID)
	return project(row), err
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
	rows, err := s.Pool.Queries().ListOwnNotifications(ctx, sqlc.ListOwnNotificationsParams{RecipientID: recipient, Unread: unread})
	items := make([]Item, 0, len(rows))
	for _, row := range rows {
		items = append(items, project(row))
	}
	return items, err
}
func (s *Service) Read(ctx context.Context, policy audit.Policy, actor *audit.Actor, id string) (Item, error) {
	return audit.Mutate(ctx, s.Audit, policy, actor, "UPDATE", func(q sqlc.Querier) (Item, audit.Change, error) {
		prior, err := q.LockOwnNotification(ctx, sqlc.LockOwnNotificationParams{ID: id, RecipientID: actor.ID})
		if errors.Is(err, sql.ErrNoRows) {
			return Item{}, audit.Change{}, ErrItem
		}
		if err != nil {
			return Item{}, audit.Change{}, err
		}
		if err = q.ReadNotification(ctx, id); err != nil {
			return Item{}, audit.Change{}, err
		}
		row, err := q.FindNotification(ctx, id)
		if err != nil {
			return Item{}, audit.Change{}, err
		}
		before := project(prior)
		value := project(row)
		change, err := audit.Capture(id, &before, &value)
		return value, change, err
	})
}
