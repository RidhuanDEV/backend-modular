-- name: FindUser :one
SELECT * FROM users WHERE id=? AND deleted_at IS NULL;
-- name: LockUser :one
SELECT * FROM users WHERE id=? AND deleted_at IS NULL FOR UPDATE;
-- name: CreateUser :exec
INSERT INTO users(id,email,password,role_id) VALUES(sqlc.arg(id),lower(sqlc.arg(email)),sqlc.arg(password),sqlc.arg(role_id));
-- name: UpdateUser :exec
UPDATE users SET email=coalesce(lower(sqlc.narg(email)),email),role_id=coalesce(sqlc.narg(role_id),role_id),updated_at=CURRENT_TIMESTAMP(3) WHERE id=sqlc.arg(id);
-- name: SoftDeleteUser :exec
UPDATE users SET deleted_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE id=?;
-- name: CountUsers :one
SELECT count(*) FROM users WHERE deleted_at IS NULL AND (sqlc.arg(search)='' OR lower(email) LIKE concat('%',lower(sqlc.arg(search)),'%'));
-- name: ListUsers :many
SELECT * FROM users WHERE deleted_at IS NULL AND (sqlc.arg(search)='' OR lower(email) LIKE concat('%',lower(sqlc.arg(search)),'%'))
ORDER BY
 CASE WHEN CAST(sqlc.arg(sort_key) AS SIGNED)=1 AND CAST(sqlc.arg(descending) AS SIGNED)=0 THEN email END ASC,
 CASE WHEN CAST(sqlc.arg(sort_key) AS SIGNED)=1 AND CAST(sqlc.arg(descending) AS SIGNED)=1 THEN email END DESC,
 CASE WHEN CAST(sqlc.arg(sort_key) AS SIGNED)=2 AND CAST(sqlc.arg(descending) AS SIGNED)=0 THEN created_at END ASC,
 CASE WHEN CAST(sqlc.arg(sort_key) AS SIGNED)=2 AND CAST(sqlc.arg(descending) AS SIGNED)=1 THEN created_at END DESC,
 CASE WHEN CAST(sqlc.arg(sort_key) AS SIGNED)=3 AND CAST(sqlc.arg(descending) AS SIGNED)=0 THEN updated_at END ASC,
 CASE WHEN CAST(sqlc.arg(sort_key) AS SIGNED)=3 AND CAST(sqlc.arg(descending) AS SIGNED)=1 THEN updated_at END DESC,
 id ASC LIMIT ? OFFSET ?;
