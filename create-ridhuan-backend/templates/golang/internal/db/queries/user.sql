-- name: FindUser :one
SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL;
-- name: LockUser :one
SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE;
-- name: CreateUser :one
INSERT INTO users(email,password,role_id) VALUES(lower($1),$2,$3) RETURNING *;
-- name: UpdateUser :one
UPDATE users SET email=coalesce(lower(sqlc.narg(email)::text),email),role_id=coalesce(sqlc.narg(role_id)::uuid,role_id),updated_at=now() WHERE id=sqlc.arg(id) RETURNING *;
-- name: SoftDeleteUser :exec
UPDATE users SET deleted_at=now(),updated_at=now() WHERE id=$1;
-- name: CountUsers :one
SELECT count(*) FROM users WHERE deleted_at IS NULL AND (sqlc.arg(search)::text='' OR email ILIKE '%'||sqlc.arg(search)::text||'%');
-- name: ListUsers :many
SELECT * FROM users WHERE deleted_at IS NULL AND (sqlc.arg(search)::text='' OR email ILIKE '%'||sqlc.arg(search)::text||'%')
ORDER BY
 CASE WHEN sqlc.arg(sort_by)::text='email' AND sqlc.arg(direction)::text='asc' THEN email END ASC,
 CASE WHEN sqlc.arg(sort_by)::text='email' AND sqlc.arg(direction)::text='desc' THEN email END DESC,
 CASE WHEN sqlc.arg(sort_by)::text='createdAt' AND sqlc.arg(direction)::text='asc' THEN created_at END ASC,
 CASE WHEN sqlc.arg(sort_by)::text='createdAt' AND sqlc.arg(direction)::text='desc' THEN created_at END DESC,
 CASE WHEN sqlc.arg(sort_by)::text='updatedAt' AND sqlc.arg(direction)::text='asc' THEN updated_at END ASC,
 CASE WHEN sqlc.arg(sort_by)::text='updatedAt' AND sqlc.arg(direction)::text='desc' THEN updated_at END DESC,
 id ASC LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);
