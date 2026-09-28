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
