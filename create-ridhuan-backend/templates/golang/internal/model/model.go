package model

import "time"

type Pagination struct {
	Page        int  `json:"page"`
	Limit       int  `json:"limit"`
	TotalItems  int  `json:"totalItems"`
	TotalPages  int  `json:"totalPages"`
	HasNextPage bool `json:"hasNextPage"`
	HasPrevPage bool `json:"hasPrevPage"`
}
type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	RoleID    string    `json:"roleId"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Role      *UserRole `json:"role,omitempty"`
}
type AuthUser struct {
	ID        string     `json:"id"`
	Email     string     `json:"email"`
	RoleID    string     `json:"roleId"`
	DeletedAt *time.Time `json:"deletedAt"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}
type UserRole struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Permissions []NamedPermission `json:"permissions"`
}
type NamedPermission struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Role struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	CreatedAt   time.Time        `json:"createdAt"`
	UpdatedAt   time.Time        `json:"updatedAt"`
	Permissions []RolePermission `json:"permissions"`
}
type RolePermission struct {
	Permission NamedPermission `json:"permission"`
}
type Permission struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type StoredFile struct {
	ID           string    `json:"id"`
	OriginalName string    `json:"originalName"`
	MIMEType     string    `json:"mimeType"`
	Size         int64     `json:"size"`
	CreatedAt    time.Time `json:"createdAt"`
}
type TokenPair struct {
	AccessToken           string
	RefreshToken          string
	AccessTokenExpiresIn  int64
	RefreshTokenExpiresAt time.Time
}
type Status struct {
	Status string `json:"status"`
}
type NameBody struct {
	Name string `json:"name" minLength:"1" maxLength:"128"`
}
type Credentials struct {
	Email    string `json:"email" format:"email"`
	Password string `json:"password" minLength:"1"`
}
type CreateUserBody struct {
	Email    string `json:"email" format:"email"`
	Password string `json:"password" minLength:"6"`
	RoleID   string `json:"roleId" format:"uuid"`
}
type UpdateUserBody struct {
	Email  *string `json:"email,omitempty" format:"email"`
	RoleID *string `json:"roleId,omitempty" format:"uuid"`
}
type PermissionAssignment struct {
	PermissionIDs []string `json:"permissionIds" minItems:"1"`
}
