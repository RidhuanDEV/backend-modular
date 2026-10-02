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
	_, err := s.Pool.Queries().FindActiveUserByID(ctx, input.RecipientID)
	if errors.Is(err, sql.ErrNoRows) {
		return Item{}, ErrRecipient
	}
	if err != nil {
		return Item{}, err
	}
	status := "NOT_REQUESTED"
	if input.SendEmail {
		status = "FAILED"
		if s.SMTP.SMTPEnabled {
			status = "PENDING"
		}
	}
	value, err := audit.Mutate(ctx, s.Audit, policy, actor, "CREATE", func(q sqlc.Querier) (Item, audit.Change, error) {
		locked, err := q.LockUser(ctx, input.RecipientID)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && locked.DeletedAt.Valid) {
			return Item{}, audit.Change{}, ErrRecipient
		}
		if err != nil {
			return Item{}, audit.Change{}, err
		}
		if err = q.EnsureNotificationCounter(ctx, input.RecipientID); err != nil {
			return Item{}, audit.Change{}, err
		}
		if err = q.IncrementNotificationCounter(ctx, input.RecipientID); err != nil {
			return Item{}, audit.Change{}, err
		}
		sequence, err := q.NotificationSequence(ctx, input.RecipientID)
		if err != nil {
			return Item{}, audit.Change{}, err
		}
		id := uuid.NewString()
		err = q.CreateNotification(ctx, sqlc.CreateNotificationParams{ID: id, RecipientID: input.RecipientID, ActorID: &actor.ID, Title: strings.TrimSpace(input.Title), Body: strings.TrimSpace(input.Body), EmailStatus: status, Sequence: sequence})
		if err != nil {
			return Item{}, audit.Change{}, err
		}
		if input.SendEmail && s.SMTP.SMTPEnabled {
			if err = q.EnqueueEmail(ctx, sqlc.EnqueueEmailParams{ID: uuid.NewString(), NotificationID: id, Recipient: locked.Email, Title: strings.TrimSpace(input.Title), Body: strings.TrimSpace(input.Body)}); err != nil {
				return Item{}, audit.Change{}, err
			}
		}
		row, err := q.FindNotification(ctx, id)
		if err != nil {
			return Item{}, audit.Change{}, err
		}
		value := project(row)
		change, err := audit.Capture(id, (*Item)(nil), &value)
		return value, change, err
	})
	return value, err
}

func (s *Service) Send(ctx context.Context, to, title, body string) error {
	options := []mail.Option{mail.WithPort(s.SMTP.SMTPPort), mail.WithTimeout(25 * time.Second)}
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
	bounded, cancel := context.WithTimeout(ctx, 25*time.Second)
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

// Cursor validates recipient ownership before a stream starts.
func (s *Service) Cursor(ctx context.Context, recipient, id string) (int64, bool, error) {
	if id == "" {
		return 0, false, nil
	}
	if _, err := uuid.Parse(id); err != nil {
		return 0, false, ErrInvalid
	}
	value, err := s.Pool.Queries().NotificationCursor(ctx, sqlc.NotificationCursorParams{ID: id, RecipientID: recipient})
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, ErrInvalid
	}
	return value, true, err
}
func (s *Service) Page(ctx context.Context, recipient, id string) ([]Item, string, error) {
	sequence, has, err := s.Cursor(ctx, recipient, id)
	if err != nil {
		return nil, "", err
	}
	rows, err := s.Pool.Queries().NotificationPage(ctx, sqlc.NotificationPageParams{RecipientID: recipient, HasCursor: has, Sequence: sequence})
	next := ""
	if len(rows) > 50 {
		next = rows[49].ID
		rows = rows[:50]
	}
	values := make([]Item, 0, len(rows))
	for _, row := range rows {
		values = append(values, project(row))
	}
	return values, next, err
}

type StreamItem struct {
	Item     Item
	Sequence int64
}

func (s *Service) Backlog(ctx context.Context, recipient string, sequence int64, has bool, unreadOnly bool) ([]StreamItem, bool, error) {
	_, err := s.Pool.Queries().FindActiveUserByID(ctx, recipient)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	rows, err := s.Pool.Queries().NotificationBacklog(ctx, sqlc.NotificationBacklogParams{RecipientID: recipient, HasCursor: has, Sequence: sequence, UnreadOnly: unreadOnly})
	values := make([]StreamItem, 0, len(rows))
	for _, row := range rows {
		values = append(values, StreamItem{Item: project(row), Sequence: row.Sequence})
	}
	return values, true, err
}
