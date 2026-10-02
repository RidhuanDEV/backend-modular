-- name: FindActiveUserByEmail :one
SELECT id,email,password,role_id,deleted_at,created_at,updated_at FROM users WHERE email=? AND deleted_at IS NULL;
-- name: FindActiveUserByID :one
SELECT id,email,password,role_id,deleted_at,created_at,updated_at FROM users WHERE id=? AND deleted_at IS NULL;
-- name: UserHasPermission :one
SELECT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id JOIN permissions p ON p.id=rp.permission_id WHERE u.id=sqlc.arg(id) AND u.deleted_at IS NULL AND p.name=sqlc.arg(name));
-- name: CreateAuthRefreshToken :exec
INSERT INTO auth_refresh_tokens(family_id,user_id,token_hash,expires_at) VALUES(?,?,?,?);
-- name: FindAuthRefreshTokenByHash :one
SELECT id,family_id,user_id,token_hash,expires_at,created_at,revoked_at FROM auth_refresh_tokens WHERE token_hash=? FOR UPDATE;
-- name: RevokeAuthRefreshToken :execrows
UPDATE auth_refresh_tokens SET revoked_at=CURRENT_TIMESTAMP(3) WHERE id=? AND revoked_at IS NULL;
-- name: RevokeAuthRefreshFamily :exec
UPDATE auth_refresh_tokens SET revoked_at=CURRENT_TIMESTAMP(3) WHERE family_id=? AND revoked_at IS NULL;
-- name: DeleteExpiredAuthRefreshTokens :exec
DELETE FROM auth_refresh_tokens WHERE user_id=? AND expires_at<CURRENT_TIMESTAMP(3);

-- name: LookupAuthRefreshToken :one
SELECT * FROM auth_refresh_tokens WHERE token_hash=sqlc.arg(token_hash);

-- name: CreateRefreshFamily :exec
INSERT INTO refresh_families(id,user_id,expires_at) VALUES(sqlc.arg(id),sqlc.arg(user_id),sqlc.arg(expires_at));
-- name: LockRefreshFamily :one
SELECT * FROM refresh_families WHERE id=sqlc.arg(id) FOR UPDATE;
-- name: RevokeRefreshFamilyRecord :exec
UPDATE refresh_families SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP(3)) WHERE id=sqlc.arg(id);
-- name: AdvanceRefreshFamily :exec
UPDATE refresh_families SET expires_at=sqlc.arg(expires_at) WHERE id=sqlc.arg(id);
