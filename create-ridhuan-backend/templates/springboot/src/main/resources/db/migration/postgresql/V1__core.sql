CREATE TABLE roles (
id UUID PRIMARY KEY,name VARCHAR(64) NOT NULL UNIQUE,created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE permissions (
id UUID PRIMARY KEY,name VARCHAR(128) NOT NULL UNIQUE,created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE app_users (
id UUID PRIMARY KEY,email VARCHAR(255) NOT NULL UNIQUE,password VARCHAR(255) NOT NULL,role_id UUID NOT NULL,deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,FOREIGN KEY(role_id) REFERENCES roles(id)
);
CREATE TABLE role_permissions (
role_id UUID NOT NULL,permission_id UUID NOT NULL,PRIMARY KEY(role_id,permission_id),FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);
CREATE TABLE activity_logs (
id UUID PRIMARY KEY,user_id UUID,actor_id_snapshot VARCHAR(36),behavior VARCHAR(64) NOT NULL,module VARCHAR(64) NOT NULL,entity_id UUID,before_snapshot JSONB,after_snapshot JSONB,request_id VARCHAR(64),endpoint_id VARCHAR(128),created_at TIMESTAMPTZ NOT NULL,FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE TABLE stored_files (
id UUID PRIMARY KEY,storage VARCHAR(16) NOT NULL,status VARCHAR(16) NOT NULL,object_key VARCHAR(255) NOT NULL UNIQUE,original_name VARCHAR(255) NOT NULL,mime_type VARCHAR(128) NOT NULL,size BIGINT NOT NULL,uploader_id UUID,created_at TIMESTAMPTZ NOT NULL,FOREIGN KEY(uploader_id) REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE INDEX users_role ON app_users(role_id);
CREATE INDEX audit_retention ON activity_logs(created_at);
CREATE INDEX audit_entity ON activity_logs(module,entity_id,created_at);
CREATE INDEX audit_actor ON activity_logs(user_id,created_at);
CREATE INDEX audit_endpoint ON activity_logs(endpoint_id,created_at);
CREATE INDEX files_uploader ON stored_files(uploader_id,created_at);
