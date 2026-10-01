-- name: FindRole :one
SELECT * FROM roles WHERE id=?;
-- name: FindRoleByName :one
SELECT * FROM roles WHERE name=?;
-- name: LockRole :one
SELECT * FROM roles WHERE id=? FOR UPDATE;
-- name: ListRoles :many
SELECT * FROM roles ORDER BY name,id;
-- name: CreateRole :exec
INSERT INTO roles(id,name) VALUES(?,?);
-- name: UpdateRole :exec
UPDATE roles SET name=sqlc.arg(name),updated_at=CURRENT_TIMESTAMP(3) WHERE id=sqlc.arg(id);
-- name: DeleteRole :exec
DELETE FROM roles WHERE id=?;
-- name: ListRolePermissions :many
SELECT p.id,p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=? ORDER BY p.name,p.id;
-- name: ListRolePermissionIDs :many
SELECT permission_id FROM role_permissions WHERE role_id=? ORDER BY permission_id;
-- name: ClearRolePermissions :exec
DELETE FROM role_permissions WHERE role_id=?;
-- name: AssignRolePermission :exec
INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?) ON DUPLICATE KEY UPDATE permission_id=permission_id;
