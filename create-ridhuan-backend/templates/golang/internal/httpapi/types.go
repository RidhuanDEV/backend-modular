package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/RidhuanDEV/golang-backend/internal/fault"
	"github.com/RidhuanDEV/golang-backend/internal/model"
	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
)

type Empty struct{}
type Success[T any] struct {
	Success bool        `json:"success"`
	Data    T           `json:"data"`
	Meta    *Pagination `json:"meta,omitempty"`
}
type Failure struct {
	Success bool     `json:"success"`
	Message string   `json:"message"`
	Errors  []string `json:"errors"`
}
type Pagination = model.Pagination
type User = model.User
type AuthUser = AuthUserResponse
type UserRole = model.UserRole
type NamedPermission = model.NamedPermission
type Role = model.Role
type RolePermission = model.RolePermission
type Permission = model.Permission
type StoredFile = model.StoredFile
type Token = TokenResponse
type Status = model.Status
type NameBody = model.NameBody
type Credentials = model.Credentials
type CreateUserBody = model.CreateUserBody
type UpdateUserBody = model.UpdateUserBody
type PermissionAssignment = model.PermissionAssignment
type IDInput struct {
	ID string `path:"id" format:"uuid"`
}
type NamedInput struct{ Body NameBody }
type CredentialsInput struct{ Body Credentials }
type RefreshInput struct {
	Body struct {
		RefreshToken string `json:"refreshToken" minLength:"1"`
	}
}
type RegisterInput struct {
	Body struct {
		Email    string `json:"email" format:"email"`
		Password string `json:"password" minLength:"6" maxLength:"72"`
	}
}
type RoleInput struct {
	Body struct {
		Name string `json:"name" minLength:"1" maxLength:"64"`
	}
}
type UpdateRoleInput struct {
	ID   string `path:"id" format:"uuid"`
	Body struct {
		Name *string `json:"name,omitempty" minLength:"1" maxLength:"64"`
	}
}
type UpdatePermissionInput struct {
	ID   string `path:"id" format:"uuid"`
	Body struct {
		Name *string `json:"name,omitempty" minLength:"1" maxLength:"128"`
	}
}
type UserInput struct{ Body CreateUserBody }
type UpdateUserInput struct {
	ID   string `path:"id" format:"uuid"`
	Body UpdateUserBody
}
type UpdateNameInput struct {
	ID   string `path:"id" format:"uuid"`
	Body NameBody
}
type AssignmentInput struct {
	ID   string `path:"id" format:"uuid"`
	Body PermissionAssignment
}
type UserListInput struct {
	Page    int    `query:"page" default:"1" minimum:"1"`
	Limit   int    `query:"limit" default:"10" minimum:"1" maximum:"100"`
	SortBy  string `query:"sortBy"`
	OrderBy string `query:"orderBy" enum:"asc,desc"`
	Search  string `query:"search"`
	Fields  string `query:"fields"`
}
type UploadInput struct {
	RawBody huma.MultipartFormFiles[UploadForm]
}

type APIError struct {
	Success bool     `json:"success"`
	Status  int      `json:"-"`
	Message string   `json:"message"`
	Errors  []string `json:"errors"`
}

func (e *APIError) GetStatus() int { return e.Status }
func apiError(err error) *APIError {
	var api *APIError
	if errors.As(err, &api) {
		if api.Errors == nil {
			api.Errors = []string{}
		}
		return api
	}
	var business *fault.Error
	if errors.As(err, &business) {
		statuses := map[fault.Kind]int{fault.Invalid: 400, fault.Missing: 404, fault.Duplicate: 409, fault.Unauthorized: 401, fault.Forbidden: 403, fault.Internal: 500, fault.TooLarge: 413, fault.Unavailable: 503}
		status := statuses[business.Kind]
		if status == 0 {
			status = 500
		}
		return &APIError{Status: status, Message: business.Message, Errors: []string{}}
	}
	return &APIError{Status: 500, Message: "Internal server error", Errors: []string{}}
}

func (e *APIError) Error() string { return e.Message }
func badRequest(message string) error {
	return &APIError{Status: http.StatusBadRequest, Message: message, Errors: []string{}}
}
func notFound() error {
	return &APIError{Status: http.StatusNotFound, Message: "Not found", Errors: []string{}}
}
func conflict(message string) error {
	return &APIError{Status: http.StatusConflict, Message: message, Errors: []string{}}
}
func internal() error {
	return &APIError{Status: http.StatusInternalServerError, Message: "Internal server error", Errors: []string{}}
}
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func writeError(w http.ResponseWriter, err error) {
	apiErr := apiError(err)
	writeJSON(w, apiErr.Status, Failure{false, apiErr.Message, apiErr.Errors})
}
func ok[T any](data T) Success[T] { return Success[T]{Success: true, Data: data} }
func validUUID(v string) error {
	if _, err := uuid.Parse(v); err != nil {
		return badRequest("Invalid UUID")
	}
	return nil
}

type UploadForm struct {
	File huma.FormFile `form:"file" required:"true"`
}
type ModuleInput struct {
	Module string `path:"module" minLength:"1"`
}
