CREATE TABLE operation_state (name VARCHAR(64) PRIMARY KEY,generation BIGINT NOT NULL DEFAULT 0,lease_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,lease_until DATETIME(6) NULL) ENGINE=InnoDB;
INSERT INTO operation_state(name) VALUES('user_cache'),('cleanup_uploads');
