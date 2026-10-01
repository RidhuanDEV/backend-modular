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
