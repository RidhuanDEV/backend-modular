package httpapi

import (
	"context"
	"errors"
	"time"

	"encoding/json"
	"fmt"
	"github.com/RidhuanDEV/golang-backend/internal/notification"
	"github.com/RidhuanDEV/golang-backend/internal/telemetry"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"net/http"
)

type notificationCreateInput struct{ Body notification.CreateInput }
type notificationPageInput struct {
	Cursor string `query:"cursor" format:"uuid" required:"false"`
}
type notificationPageOutput struct {
	Next string `header:"X-Next-Cursor" doc:"UUID cursor for the next page; absent on final page"`
	Body Success[[]notification.Item]
}
type notificationStreamInput struct {
	LastEventID string `header:"Last-Event-ID" required:"false" doc:"UUID of this recipient's last notification"`
}

func (s *Server) mountNotifications() {
	register[notificationCreateInput, notification.Item](s, "notification.create", func(ctx context.Context, input *notificationCreateInput, actor *Actor) (Success[notification.Item], error) {
		if err := validUUID(input.Body.RecipientID); err != nil {
			return Success[notification.Item]{}, err
		}
		item, err := s.Notifications.Create(ctx, s.policy(ctx, "notification.create"), actor, input.Body)
		if errors.Is(err, notification.ErrRecipient) {
			return Success[notification.Item]{}, notFound()
		}
		if errors.Is(err, notification.ErrInvalid) {
			return Success[notification.Item]{}, badRequest("Invalid notification")
		}
		return ok(item), err
	})
	huma.Register(s.Docs, s.operation("notification.list"), func(ctx context.Context, input *notificationPageInput) (*notificationPageOutput, error) {
		actor, _ := ctx.Value(actorKey{}).(*Actor)
		if actor == nil {
			return nil, &APIError{Status: 401, Message: "Unauthorized", Errors: []string{}}
		}
		values, next, err := s.Notifications.Page(ctx, actor.ID, input.Cursor)
		if errors.Is(err, notification.ErrInvalid) {
			return nil, badRequest("Invalid notification cursor")
		}
		if err != nil {
			return nil, apiError(err)
		}
		s.Audit.Read(ctx, s.policy(ctx, "notification.list"), actor, "")
		return &notificationPageOutput{Next: next, Body: ok(values)}, nil
	})
	register[IDInput, notification.Item](s, "notification.read", func(ctx context.Context, input *IDInput, actor *Actor) (Success[notification.Item], error) {
		item, err := s.Notifications.Read(ctx, s.policy(ctx, "notification.read"), actor, input.ID)
		if errors.Is(err, notification.ErrItem) {
			return Success[notification.Item]{}, notFound()
		}
		return ok(item), err
	})
	op := s.operation("notification.stream")
	op.Responses = map[string]*huma.Response{"200": {Description: "Notification SSE; event id is the notification UUID", Content: map[string]*huma.MediaType{"text/event-stream": {Schema: &huma.Schema{Type: "string"}}}}}
	huma.Register(s.Docs, op, func(ctx context.Context, input *notificationStreamInput) (*huma.StreamResponse, error) {
		actor, _ := ctx.Value(actorKey{}).(*Actor)
		if actor == nil || actor.ExpiresAt.IsZero() {
			return nil, &APIError{Status: 401, Message: "Unauthorized", Errors: []string{}}
		}
		sequence, has, err := s.Notifications.Cursor(ctx, actor.ID, input.LastEventID)
		if errors.Is(err, notification.ErrInvalid) {
			return nil, badRequest("Invalid notification cursor")
		}
		if err != nil {
			return nil, apiError(err)
		}
		unreadOnly := !has
		return &huma.StreamResponse{Body: func(hctx huma.Context) {
			telemetry.SSE(ctx, 1)
			defer telemetry.SSE(ctx, -1)
			_, w := humachi.Unwrap(hctx)
			control := http.NewResponseController(w)
			defer func() {
				// The last event's deadline can expire during an idle poll. Give the
				// HTTP server a bounded window to write its final chunk on return.
				_ = control.SetWriteDeadline(time.Now().Add(5 * time.Second))
			}()
			hctx.SetHeader("Content-Type", "text/event-stream")
			hctx.SetHeader("Cache-Control", "no-cache, no-transform")
			hctx.SetHeader("X-Accel-Buffering", "no")
			hctx.SetStatus(200)
			if control.Flush() != nil {
				return
			}
			deadline := time.Now().Add(14 * time.Minute)
			if actor.ExpiresAt.Before(deadline) {
				deadline = actor.ExpiresAt
			}
			streamCtx, cancel := context.WithDeadline(ctx, deadline)
			defer cancel()
			ticker := time.NewTicker(3 * time.Second)
			defer ticker.Stop()
			heartbeat := time.NewTicker(15 * time.Second)
			defer heartbeat.Stop()
			write := func(text string) bool {
				if streamCtx.Err() != nil {
					return false
				}
				if control.SetWriteDeadline(time.Now().Add(5*time.Second)) != nil {
					return false
				}
				if _, err := fmt.Fprint(w, text); err != nil {
					return false
				}
				return control.Flush() == nil
			}
			poll := func() bool {
				for {
					values, active, err := s.Notifications.Backlog(streamCtx, actor.ID, sequence, has, unreadOnly)
					if err != nil || !active {
						return false
					}
					for _, value := range values {
						data, err := json.Marshal(value.Item)
						if err != nil {
							return false
						}
						if !write(fmt.Sprintf("id: %s\nevent: notification\ndata: %s\n\n", value.Item.ID, data)) {
							return false
						}
						sequence = value.Sequence
						has = true
						select {
						case <-heartbeat.C:
							if !write(": heartbeat\n\n") {
								return false
							}
						default:
						}
					}
					if len(values) < 50 {
						return true
					}
				}
			}
			if !poll() {
				return
			}
			for {
				select {
				case <-streamCtx.Done():
					return
				case <-ticker.C:
					if !poll() {
						return
					}
				case <-heartbeat.C:
					if !write(": heartbeat\n\n") {
						return
					}
				}
			}
		}}, nil
	})
}
