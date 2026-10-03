CREATE TABLE operation_state (name VARCHAR(64) PRIMARY KEY,generation BIGINT NOT NULL DEFAULT 0,lease_id UUID,lease_until TIMESTAMPTZ);
INSERT INTO operation_state(name) VALUES('user_cache'),('cleanup_uploads');
