package httpapi

import (
	"context"
	"errors"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/notification"
	"github.com/danielgtaylor/huma/v2/sse"
)

type notificationCreateInput struct{ Body notification.CreateInput }

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
	register[Empty, []notification.Item](s, "notification.list", func(ctx context.Context, _ *Empty, actor *Actor) (Success[[]notification.Item], error) {
		values, err := s.Notifications.List(ctx, actor.ID, false)
		return ok(values), err
	})
	register[IDInput, notification.Item](s, "notification.read", func(ctx context.Context, input *IDInput, actor *Actor) (Success[notification.Item], error) {
		item, err := s.Notifications.Read(ctx, s.policy(ctx, "notification.read"), actor, input.ID)
		if errors.Is(err, notification.ErrItem) {
			return Success[notification.Item]{}, notFound()
		}
		return ok(item), err
	})
	sse.Register[Empty](s.Docs, s.operation("notification.stream"), map[string]any{"notification": notification.Item{}}, func(ctx context.Context, _ *Empty, send sse.Sender) {
		actor, ok := ctx.Value(actorKey{}).(*Actor)
		if !ok || actor == nil {
			return
		}
		if actor.ExpiresAt.IsZero() {
			return
		}
		streamCtx, cancel := context.WithDeadline(ctx, actor.ExpiresAt)
		defer cancel()
		seen := make(map[string]struct{})
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()
		poll := func() bool {
			values, err := s.Notifications.List(streamCtx, actor.ID, true)
			if err != nil {
				s.Logger.Warn("notification stream poll failed", "error", err)
				return false
			}
			for index := len(values) - 1; index >= 0; index-- {
				value := values[index]
				if _, exists := seen[value.ID]; exists {
					continue
				}
				if err := send.Data(value); err != nil {
					return false
				}
				seen[value.ID] = struct{}{}
			}
			return true
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
				if send.Comment("heartbeat") != nil {
					return
				}
			}
		}
	})
}
