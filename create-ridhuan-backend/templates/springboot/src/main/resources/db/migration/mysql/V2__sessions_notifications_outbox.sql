CREATE TABLE refresh_families (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,expires_at DATETIME(6) NOT NULL,revoked_at DATETIME(6),created_at DATETIME(6) NOT NULL,FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE refresh_tokens (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,token_hash VARCHAR(64) NOT NULL UNIQUE,family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,expires_at DATETIME(6) NOT NULL,consumed_at DATETIME(6),created_at DATETIME(6) NOT NULL,FOREIGN KEY(family_id) REFERENCES refresh_families(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE notification_counters (
recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,sequence BIGINT NOT NULL,FOREIGN KEY(recipient_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE notifications (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,sequence BIGINT NOT NULL,title VARCHAR(160) NOT NULL,body VARCHAR(4000) NOT NULL,email_status VARCHAR(16) NOT NULL,read_at DATETIME(6),created_at DATETIME(6) NOT NULL,UNIQUE(recipient_id,sequence),FOREIGN KEY(recipient_id) REFERENCES app_users(id) ON DELETE CASCADE,FOREIGN KEY(actor_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE email_jobs (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,notification_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,recipient VARCHAR(255) NOT NULL,title VARCHAR(160) NOT NULL,body VARCHAR(4000) NOT NULL,status VARCHAR(16) NOT NULL,attempts INT NOT NULL,available_at DATETIME(6) NOT NULL,lease_until DATETIME(6),lease_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,completed_at DATETIME(6),created_at DATETIME(6) NOT NULL,FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX family_retention ON refresh_families(expires_at,revoked_at);
CREATE INDEX tokens_family ON refresh_tokens(family_id);
CREATE INDEX notification_order ON notifications(recipient_id,sequence);
CREATE INDEX email_claim ON email_jobs(status,available_at,lease_until);
CREATE INDEX email_retention ON email_jobs(completed_at);
