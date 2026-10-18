-- name: FindPermission :one
SELECT * FROM permissions WHERE id=$1;
-- name: LockPermission :one
SELECT * FROM permissions WHERE id=$1 FOR UPDATE;
-- name: ListPermissions :many
SELECT * FROM permissions ORDER BY name,id;
-- name: CreatePermission :one
INSERT INTO permissions(name) VALUES($1) RETURNING *;
-- name: UpdatePermission :one
UPDATE permissions SET name=$2,updated_at=now() WHERE id=$1 RETURNING *;
-- name: DeletePermission :exec
DELETE FROM permissions WHERE id=$1;
-- name: LockPermissionByName :many
SELECT id FROM permissions WHERE name=sqlc.arg(name) FOR UPDATE;
-- name: CountActivePermissionHolders :one
SELECT COUNT(*) FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id JOIN permissions p ON p.id=rp.permission_id WHERE p.name=sqlc.arg(name) AND u.deleted_at IS NULL;
-- name: ListRoleIDsWithPermissionName :many
SELECT rp.role_id FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.name=sqlc.arg(name);
