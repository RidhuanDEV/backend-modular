package audit

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCaptureRedactsNestedSecrets(t *testing.T) {
	payload := struct {
		Name     string `json:"name"`
		Password string `json:"password"`
		Nested   struct {
			Token string `json:"token"`
			Value string `json:"value"`
		} `json:"nested"`
	}{Name: "visible", Password: "never-store"}
	payload.Nested.Token = "never-store"
	payload.Nested.Value = "visible"
	change, err := Capture("id", (*struct {
		Name     string `json:"name"`
		Password string `json:"password"`
		Nested   struct {
			Token string `json:"token"`
			Value string `json:"value"`
		} `json:"nested"`
	})(nil), &payload)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(change.After), "never-store") || strings.Contains(string(change.After), "password") || strings.Contains(string(change.After), "token") || !json.Valid(change.After) {
		t.Fatal("unsafe snapshot", string(change.After))
	}
	if !strings.Contains(string(change.After), "visible") || change.Before != nil {
		t.Fatal("safe data lost")
	}
}
