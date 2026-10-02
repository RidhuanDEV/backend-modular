package httpapi

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/notification"
)

func TestNotificationsPersistAndRestrictRecipient(t *testing.T) {
	server, pool, token := integrationServer(t)
	me := decodeBody[AuthUser](t, call(t, server, "GET", "/api/auth/me", token, nil, 200))
	created := decodeBody[notification.Item](t, call(t, server, "POST", "/api/notifications", token,
		notification.CreateInput{RecipientID: me.ID, Title: "Hello", Body: "Your update", SendEmail: true}, 201))
	if created.EmailStatus != "FAILED" || created.RecipientID != me.ID {
		t.Fatalf("unexpected notification: %+v", created)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM notifications WHERE id=$1`, created.ID) })
	listed := decodeBody[[]notification.Item](t, call(t, server, "GET", "/api/notifications", token, nil, 200))
	found := false
	for _, item := range listed {
		if item.ID == created.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("notification not listed for recipient")
	}
	listener := httptest.NewServer(server.Router)
	defer listener.Close()
	streamCtx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(streamCtx, http.MethodGet, listener.URL+"/api/notifications/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	stream, err := listener.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	if stream.StatusCode != 200 || !strings.HasPrefix(stream.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("unexpected SSE response: %d %s", stream.StatusCode, stream.Header.Get("Content-Type"))
	}
	reader := bufio.NewReader(stream.Body)
	for {
		line, readErr := reader.ReadString('\n')
		if readErr != nil {
			t.Fatalf("missing notification cursor %s: %v", created.ID, readErr)
		}
		if strings.TrimSpace(line) == "id: "+created.ID {
			break
		}
	}
	line, err := reader.ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "event: notification" {
		t.Fatalf("missing notification SSE event: %q %v", line, err)
	}
	read := decodeBody[notification.Item](t, call(t, server, "PATCH", "/api/notifications/"+created.ID+"/read", token, nil, 200))
	if read.ReadAt == nil {
		t.Fatal("notification not marked read")
	}
	var audits int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM activity_logs WHERE module='notifications' AND entity_id=$1`, created.ID).Scan(&audits); err != nil || audits != 2 {
		t.Fatalf("notification audits=%d: %v", audits, err)
	}
}
