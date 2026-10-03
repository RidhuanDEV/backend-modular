CREATE TABLE roles (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,name VARCHAR(64) NOT NULL UNIQUE,created_at DATETIME(6) NOT NULL,updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE permissions (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,name VARCHAR(128) NOT NULL UNIQUE,created_at DATETIME(6) NOT NULL,updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE app_users (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,email VARCHAR(255) NOT NULL UNIQUE,password VARCHAR(255) NOT NULL,role_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,deleted_at DATETIME(6),created_at DATETIME(6) NOT NULL,updated_at DATETIME(6) NOT NULL,FOREIGN KEY(role_id) REFERENCES roles(id)
) ENGINE=InnoDB;
CREATE TABLE role_permissions (
role_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,permission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,PRIMARY KEY(role_id,permission_id),FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE activity_logs (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,actor_id_snapshot VARCHAR(36),behavior VARCHAR(64) NOT NULL,module VARCHAR(64) NOT NULL,entity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,before_snapshot JSON,after_snapshot JSON,request_id VARCHAR(64),endpoint_id VARCHAR(128),created_at DATETIME(6) NOT NULL,FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE stored_files (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,storage VARCHAR(16) NOT NULL,status VARCHAR(16) NOT NULL,object_key VARCHAR(255) NOT NULL UNIQUE,original_name VARCHAR(255) NOT NULL,mime_type VARCHAR(128) NOT NULL,size BIGINT NOT NULL,uploader_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,created_at DATETIME(6) NOT NULL,FOREIGN KEY(uploader_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX users_role ON app_users(role_id);
CREATE INDEX audit_retention ON activity_logs(created_at);
CREATE INDEX audit_entity ON activity_logs(module,entity_id,created_at);
CREATE INDEX audit_actor ON activity_logs(user_id,created_at);
CREATE INDEX audit_endpoint ON activity_logs(endpoint_id,created_at);
CREATE INDEX files_uploader ON stored_files(uploader_id,created_at);
