-- name: FindPermission :one
SELECT * FROM permissions WHERE id=?;
-- name: LockPermission :one
SELECT * FROM permissions WHERE id=? FOR UPDATE;
-- name: ListPermissions :many
SELECT * FROM permissions ORDER BY name,id;
-- name: CreatePermission :exec
INSERT INTO permissions(id,name) VALUES(?,?);
-- name: UpdatePermission :exec
UPDATE permissions SET name=sqlc.arg(name),updated_at=CURRENT_TIMESTAMP(3) WHERE id=sqlc.arg(id);
-- name: DeletePermission :exec
DELETE FROM permissions WHERE id=?;
-- name: LockPermissionByName :many
SELECT id FROM permissions WHERE name=sqlc.arg(name) FOR UPDATE;
-- name: CountActivePermissionHolders :one
SELECT COUNT(*) FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id JOIN permissions p ON p.id=rp.permission_id WHERE p.name=sqlc.arg(name) AND u.deleted_at IS NULL;
-- name: ListRoleIDsWithPermissionName :many
SELECT rp.role_id FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.name=sqlc.arg(name);
