CREATE TABLE refresh_families (
id UUID PRIMARY KEY,user_id UUID NOT NULL,expires_at TIMESTAMPTZ NOT NULL,revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
);
CREATE TABLE refresh_tokens (
id UUID PRIMARY KEY,token_hash VARCHAR(64) NOT NULL UNIQUE,family_id UUID NOT NULL,expires_at TIMESTAMPTZ NOT NULL,consumed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,FOREIGN KEY(family_id) REFERENCES refresh_families(id) ON DELETE CASCADE
);
CREATE TABLE notification_counters (
recipient_id UUID PRIMARY KEY,sequence BIGINT NOT NULL,FOREIGN KEY(recipient_id) REFERENCES app_users(id) ON DELETE CASCADE
);
CREATE TABLE notifications (
id UUID PRIMARY KEY,recipient_id UUID NOT NULL,actor_id UUID,sequence BIGINT NOT NULL,title VARCHAR(160) NOT NULL,body VARCHAR(4000) NOT NULL,email_status VARCHAR(16) NOT NULL,read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,UNIQUE(recipient_id,sequence),FOREIGN KEY(recipient_id) REFERENCES app_users(id) ON DELETE CASCADE,FOREIGN KEY(actor_id) REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE TABLE email_jobs (
id UUID PRIMARY KEY,notification_id UUID NOT NULL UNIQUE,recipient VARCHAR(255) NOT NULL,title VARCHAR(160) NOT NULL,body VARCHAR(4000) NOT NULL,status VARCHAR(16) NOT NULL,attempts INT NOT NULL,available_at TIMESTAMPTZ NOT NULL,lease_until TIMESTAMPTZ,lease_id UUID,completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);
CREATE INDEX family_retention ON refresh_families(expires_at,revoked_at);
CREATE INDEX tokens_family ON refresh_tokens(family_id);
CREATE INDEX notification_order ON notifications(recipient_id,sequence);
CREATE INDEX email_claim ON email_jobs(status,available_at,lease_until);
CREATE INDEX email_retention ON email_jobs(completed_at);
