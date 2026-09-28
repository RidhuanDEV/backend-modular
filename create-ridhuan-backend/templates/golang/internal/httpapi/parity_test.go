package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
)

// The fixture is the Express snapshot plus explicitly listed Go-only extensions.
// Row order: ID, method, path, module, public, permission, audit, rate, cache, status.
func TestExpressEndpointParity(t *testing.T) {
	content, err := os.ReadFile("../../contracts/express-endpoints.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Source    string              `json:"source"`
		Endpoints [][]json.RawMessage `json:"endpoints"`
	}
	if err = json.Unmarshal(content, &fixture); err != nil {
		t.Fatal(err)
	}
	var extension struct {
		Source    string              `json:"source"`
		Endpoints [][]json.RawMessage `json:"endpoints"`
	}
	local, err := os.ReadFile("../../contracts/go-endpoint-extensions.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(local, &extension); err != nil {
		t.Fatal(err)
	}
	if fixture.Source == "" || extension.Source == "" || len(fixture.Endpoints)+len(extension.Endpoints) != len(Definitions) {
		t.Fatalf("Express fixture plus Go extensions has %d endpoints; Go has %d", len(fixture.Endpoints)+len(extension.Endpoints), len(Definitions))
	}
	goEndpoints := make(map[EndpointID]Endpoint, len(Definitions))
	for _, endpoint := range Definitions {
		goEndpoints[endpoint.ID] = endpoint
	}
	server, err := newTestServer(testConfig(), nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Router.ServeHTTP(response, httptest.NewRequest("GET", "/docs/openapi.json", nil))
	if response.Code != 200 {
		t.Fatalf("OpenAPI status %d", response.Code)
	}
	var spec struct {
		Paths map[string]map[string]struct {
			OperationID string                     `json:"operationId"`
			Responses   map[string]json.RawMessage `json:"responses"`
		} `json:"paths"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	for _, row := range append(fixture.Endpoints, extension.Endpoints...) {
		if len(row) != 10 {
			t.Fatalf("invalid Express contract row with %d columns", len(row))
		}
		read := func(index int, target interface{}) {
			t.Helper()
			if decodeErr := json.Unmarshal(row[index], target); decodeErr != nil {
				t.Fatalf("contract column %d: %v", index, decodeErr)
			}
		}
		var id, method, path, module, permission, audit, rate, cache string
		var public bool
		var status int
		read(0, &id)
		read(1, &method)
		read(2, &path)
		read(3, &module)
		read(4, &public)
		read(5, &permission)
		read(6, &audit)
		read(7, &rate)
		read(8, &cache)
		read(9, &status)
		actual, ok := goEndpoints[EndpointID(id)]
		if !ok {
			t.Fatalf("Express endpoint %q missing in Go", id)
		}
		if actual.Method != method || actual.Path != path || actual.Module != module || actual.Public != public || actual.Permission != permission || string(actual.Audit) != audit || string(actual.Rate) != rate || string(actual.Cache) != cache || actual.Status != status {
			t.Errorf("%s differs from Express registry snapshot: %+v", id, actual)
		}
		operation, exists := spec.Paths[path][strings.ToLower(method)]
		if !exists || operation.OperationID != id {
			t.Errorf("OpenAPI operation %s %s differs from Express endpoint %s", method, path, id)
		} else if _, documented := operation.Responses[strconv.Itoa(status)]; !documented {
			t.Errorf("OpenAPI operation %s does not document status %d", id, status)
		}
		delete(goEndpoints, actual.ID)
	}
	if len(goEndpoints) != 0 {
		t.Fatalf("Go registry has %d endpoints absent from Express snapshot", len(goEndpoints))
	}
}
