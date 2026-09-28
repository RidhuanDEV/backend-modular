-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password text NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  deleted_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower CHECK (email = lower(email))
);
CREATE INDEX users_role_id_idx ON users(role_id);
CREATE INDEX users_active_email_idx ON users(email) WHERE deleted_at IS NULL;
CREATE TABLE activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  behavior text NOT NULL,
  module text NOT NULL,
  entity_id text,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_id_snapshot text,
  before jsonb,
  after jsonb,
  request_id text,
  endpoint_id text,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX activity_logs_entity_idx ON activity_logs(module, entity_id, created_at DESC);
CREATE INDEX activity_logs_user_idx ON activity_logs(user_id, created_at DESC);
CREATE INDEX activity_logs_endpoint_idx ON activity_logs(endpoint_id, created_at DESC);
CREATE TABLE stored_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage text NOT NULL CHECK (storage IN ('local','s3')),
  status text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','PENDING')),
  object_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size bigint NOT NULL CHECK (size >= 0),
  uploader_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX stored_files_uploader_idx ON stored_files(uploader_id, created_at DESC);

-- +goose Down
DROP TABLE stored_files;
DROP TABLE activity_logs;
DROP TABLE users;
DROP TABLE role_permissions;
DROP TABLE permissions;
DROP TABLE roles;
