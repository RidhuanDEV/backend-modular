-- +goose Up
CREATE TABLE roles (
 id char(36) PRIMARY KEY DEFAULT (uuid()), name varchar(64) NOT NULL UNIQUE,
 created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE TABLE permissions (
 id char(36) PRIMARY KEY DEFAULT (uuid()), name varchar(128) NOT NULL UNIQUE,
 created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE TABLE role_permissions (
 role_id char(36) NOT NULL, permission_id char(36) NOT NULL, PRIMARY KEY (role_id,permission_id),
 FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
 FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE TABLE users (
 id char(36) PRIMARY KEY DEFAULT (uuid()), email varchar(255) NOT NULL UNIQUE, password varchar(255) NOT NULL,
 role_id char(36) NOT NULL, deleted_at datetime(3), created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE RESTRICT,
 CONSTRAINT users_email_lower CHECK(email = lower(email)), INDEX users_role_id_idx(role_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE TABLE activity_logs (
 id char(36) PRIMARY KEY DEFAULT (uuid()), behavior varchar(64) NOT NULL, module varchar(64) NOT NULL, entity_id text, user_id char(36), actor_id_snapshot text,
 `before` json, `after` json, request_id text, endpoint_id text, created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
 INDEX activity_logs_entity_idx(module,entity_id(128),created_at), INDEX activity_logs_user_idx(user_id,created_at), INDEX activity_logs_endpoint_idx(endpoint_id(128),created_at), INDEX activity_logs_request_idx(request_id(128),created_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE TABLE stored_files (
 id char(36) PRIMARY KEY DEFAULT (uuid()), storage varchar(16) NOT NULL CHECK(storage IN ('local','s3')),
 status varchar(16) NOT NULL DEFAULT 'READY' CHECK(status IN ('READY','PENDING')), object_key varchar(255) NOT NULL UNIQUE, original_name varchar(255) NOT NULL,
 mime_type varchar(128) NOT NULL, size bigint NOT NULL CHECK(size >= 0), uploader_id char(36), created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(uploader_id) REFERENCES users(id) ON DELETE SET NULL, INDEX stored_files_uploader_idx(uploader_id,created_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
-- +goose Down
DROP TABLE stored_files;
DROP TABLE activity_logs;
DROP TABLE users;
DROP TABLE role_permissions;
DROP TABLE permissions;
DROP TABLE roles;
