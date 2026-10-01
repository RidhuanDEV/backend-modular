-- +goose Up
CREATE TABLE auth_refresh_tokens (
 id char(36) PRIMARY KEY DEFAULT (uuid()), family_id char(36) NOT NULL, user_id char(36) NOT NULL, token_hash binary(32) NOT NULL UNIQUE,
 expires_at datetime(3) NOT NULL, created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), revoked_at datetime(3),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX auth_refresh_tokens_family_idx(family_id), INDEX auth_refresh_tokens_user_expiry_idx(user_id,expires_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
-- +goose Down
DROP TABLE auth_refresh_tokens;
