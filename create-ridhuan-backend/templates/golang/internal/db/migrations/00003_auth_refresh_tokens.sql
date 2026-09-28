-- +goose Up
CREATE TABLE auth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  revoked_at timestamptz(3),
  CONSTRAINT auth_refresh_tokens_hash_length CHECK (octet_length(token_hash) = 32)
);

CREATE INDEX auth_refresh_tokens_family_idx ON auth_refresh_tokens(family_id);
CREATE INDEX auth_refresh_tokens_user_expiry_idx ON auth_refresh_tokens(user_id, expires_at);

-- +goose Down
DROP TABLE auth_refresh_tokens;
