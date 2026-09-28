-- name: FindRole :one
SELECT * FROM roles WHERE id=$1;
-- name: FindRoleByName :one
SELECT * FROM roles WHERE name=$1;
-- name: LockRole :one
SELECT * FROM roles WHERE id=$1 FOR UPDATE;
-- name: ListRoles :many
SELECT * FROM roles ORDER BY name,id;
-- name: CreateRole :one
INSERT INTO roles(name) VALUES($1) RETURNING *;
-- name: UpdateRole :one
UPDATE roles SET name=$2,updated_at=now() WHERE id=$1 RETURNING *;
-- name: DeleteRole :exec
DELETE FROM roles WHERE id=$1;
-- name: ListRolePermissions :many
SELECT p.id,p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=$1 ORDER BY p.name,p.id;
-- name: ListRolePermissionIDs :many
SELECT permission_id FROM role_permissions WHERE role_id=$1 ORDER BY permission_id;
-- name: ClearRolePermissions :exec
DELETE FROM role_permissions WHERE role_id=$1;
-- name: AssignRolePermission :exec
INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING;
