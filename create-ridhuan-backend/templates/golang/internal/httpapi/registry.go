package httpapi

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/RidhuanDEV/golang-backend/internal/config"
)

type AuditMode string

const (
	AuditRequired AuditMode = "required"
	AuditOptional AuditMode = "optional"
	AuditNone     AuditMode = "none"
)

type CacheMode string

const (
	CacheRead CacheMode = "read"
	CacheOff  CacheMode = "off"
)

type RateGroup string

const (
	RateAuth     RateGroup = "auth"
	RatePublic   RateGroup = "public"
	RateInternal RateGroup = "internal"
)

type EndpointID string
type Endpoint struct {
	ID                                        EndpointID
	Method, Path, Module, Summary, Permission string
	Public                                    bool
	Audit                                     AuditMode
	Cache                                     CacheMode
	Rate                                      RateGroup
	Status                                    int
}

var Definitions = []Endpoint{
	{"health.get", "GET", "/health", "system", "Health check", "", true, AuditNone, CacheOff, RatePublic, 200},
	{"live.get", "GET", "/live", "system", "Process liveness", "", true, AuditNone, CacheOff, RatePublic, 200},
	{"ready.get", "GET", "/ready", "system", "Dependency readiness", "", true, AuditNone, CacheOff, RatePublic, 200},
	{"docs.ui", "GET", "/docs", "docs", "API documentation", "", true, AuditNone, CacheOff, RatePublic, 200},
	{"docs.spec", "GET", "/docs/openapi.json", "docs", "OpenAPI specification", "", true, AuditNone, CacheOff, RatePublic, 200},
	{"docs.moduleSpec", "GET", "/docs/specs/{module}.json", "docs", "Module specification", "", true, AuditNone, CacheOff, RatePublic, 200},
	{"auth.register", "POST", "/api/auth/register", "auth", "Register account", "", true, AuditRequired, CacheOff, RateAuth, 201},
	{"auth.login", "POST", "/api/auth/login", "auth", "Login", "", true, AuditOptional, CacheOff, RateAuth, 200},
	{"auth.refresh", "POST", "/api/auth/refresh", "auth", "Rotate refresh token", "", true, AuditRequired, CacheOff, RateAuth, 200},
	{"auth.me", "GET", "/api/auth/me", "auth", "Current user", "", false, AuditNone, CacheOff, RateInternal, 200},
	{"user.list", "GET", "/api/users", "user", "List users", "manage_users", false, AuditNone, CacheRead, RateInternal, 200},
	{"user.get", "GET", "/api/users/{id}", "user", "Get user", "manage_users", false, AuditNone, CacheRead, RateInternal, 200},
	{"user.create", "POST", "/api/users", "user", "Create user", "manage_users", false, AuditRequired, CacheOff, RateInternal, 201},
	{"user.update", "PATCH", "/api/users/{id}", "user", "Update user", "manage_users", false, AuditRequired, CacheOff, RateInternal, 200},
	{"user.delete", "DELETE", "/api/users/{id}", "user", "Delete user", "manage_users", false, AuditRequired, CacheOff, RateInternal, 204},
	{"role.list", "GET", "/api/roles", "roles", "List roles", "manage_roles", false, AuditNone, CacheRead, RateInternal, 200},
	{"role.get", "GET", "/api/roles/{id}", "roles", "Get role", "manage_roles", false, AuditNone, CacheRead, RateInternal, 200},
	{"role.create", "POST", "/api/roles", "roles", "Create role", "manage_roles", false, AuditRequired, CacheOff, RateInternal, 201},
	{"role.update", "PATCH", "/api/roles/{id}", "roles", "Update role", "manage_roles", false, AuditRequired, CacheOff, RateInternal, 200},
	{"role.delete", "DELETE", "/api/roles/{id}", "roles", "Delete role", "manage_roles", false, AuditRequired, CacheOff, RateInternal, 204},
	{"role.assignPermissions", "POST", "/api/roles/{id}/permissions", "roles", "Assign permissions", "manage_roles", false, AuditRequired, CacheOff, RateInternal, 200},
	{"permission.list", "GET", "/api/permissions", "permissions", "List permissions", "manage_permissions", false, AuditNone, CacheRead, RateInternal, 200},
	{"permission.get", "GET", "/api/permissions/{id}", "permissions", "Get permission", "manage_permissions", false, AuditNone, CacheRead, RateInternal, 200},
	{"permission.create", "POST", "/api/permissions", "permissions", "Create permission", "manage_permissions", false, AuditRequired, CacheOff, RateInternal, 201},
	{"permission.update", "PATCH", "/api/permissions/{id}", "permissions", "Update permission", "manage_permissions", false, AuditRequired, CacheOff, RateInternal, 200},
	{"permission.delete", "DELETE", "/api/permissions/{id}", "permissions", "Delete permission", "manage_permissions", false, AuditRequired, CacheOff, RateInternal, 204},
	{"upload.create", "POST", "/api/upload", "upload", "Upload file", "manage_users", false, AuditRequired, CacheOff, RateInternal, 201},
	{"upload.get", "GET", "/api/upload/{id}", "upload", "Get file metadata", "manage_users", false, AuditNone, CacheRead, RateInternal, 200},
}

func Resolve(c config.Config) (map[EndpointID]Endpoint, error) {
	result := make(map[EndpointID]Endpoint, len(Definitions))
	routes := map[string]struct{}{}
	for _, base := range Definitions {
		if _, exists := result[base.ID]; exists {
			return nil, fmt.Errorf("duplicate endpoint ID %s", base.ID)
		}
		key := base.Method + " " + base.Path
		if _, exists := routes[key]; exists {
			return nil, fmt.Errorf("duplicate route %s", key)
		}
		routes[key] = struct{}{}
		if _, ok := c.Rates[string(base.Rate)]; !ok {
			return nil, fmt.Errorf("missing rate group for %s", base.ID)
		}
		if override, ok := c.Policies[string(base.ID)]; ok {
			if override.Audit != "" {
				mode := AuditMode(override.Audit)
				if mode != AuditRequired && mode != AuditOptional && mode != AuditNone {
					return nil, fmt.Errorf("invalid audit policy for %s", base.ID)
				}
				if base.Method == http.MethodGet && mode == AuditRequired {
					return nil, fmt.Errorf("required GET audit producer missing for %s", base.ID)
				}
				base.Audit = mode
			}
			if override.RateLimit != "" {
				group := RateGroup(override.RateLimit)
				if _, found := c.Rates[string(group)]; !found {
					return nil, fmt.Errorf("invalid rate group for %s", base.ID)
				}
				base.Rate = group
			}
			if override.Cache != "" {
				mode := CacheMode(override.Cache)
				if mode != CacheRead && mode != CacheOff {
					return nil, fmt.Errorf("invalid cache policy for %s", base.ID)
				}
				if base.Method != http.MethodGet && mode == CacheRead {
					return nil, errors.New("cache read only allowed for GET")
				}
				base.Cache = mode
			}
		}
		result[base.ID] = base
	}
	for id := range c.Policies {
		if _, found := result[EndpointID(id)]; !found {
			return nil, fmt.Errorf("unknown endpoint policy override %s", id)
		}
	}
	return result, nil
}
