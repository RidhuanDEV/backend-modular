-- +goose Up
CREATE TABLE refresh_families (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz(3) NOT NULL DEFAULT now(), expires_at timestamptz(3) NOT NULL, revoked_at timestamptz(3)
);
INSERT INTO refresh_families(id,user_id,created_at,expires_at,revoked_at)
 SELECT family_id,user_id,MIN(created_at),MAX(expires_at),
 CASE WHEN SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END)=0 THEN MAX(revoked_at) ELSE NULL END
 FROM auth_refresh_tokens GROUP BY family_id,user_id;
CREATE INDEX refresh_families_retention_idx ON refresh_families(revoked_at,expires_at);
ALTER TABLE auth_refresh_tokens ADD CONSTRAINT refresh_tokens_family_fk FOREIGN KEY(family_id) REFERENCES refresh_families(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN sequence BIGINT;
UPDATE notifications n SET sequence=r.sequence FROM (SELECT id,row_number() OVER(PARTITION BY recipient_id ORDER BY created_at,id) AS sequence FROM notifications) r WHERE n.id=r.id;
ALTER TABLE notifications ALTER COLUMN sequence SET NOT NULL;
CREATE UNIQUE INDEX notifications_sequence_idx ON notifications(recipient_id,sequence);
CREATE TABLE notification_counters (
 recipient_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, sequence BIGINT NOT NULL DEFAULT 0
);
INSERT INTO notification_counters(recipient_id,sequence) SELECT recipient_id,MAX(sequence) FROM notifications GROUP BY recipient_id;
CREATE TABLE email_jobs (
 id uuid PRIMARY KEY, notification_id uuid NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
 recipient varchar(255) NOT NULL, title varchar(160) NOT NULL, body varchar(4000) NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','SENT','FAILED')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz(3) NOT NULL DEFAULT now(),
 lease_id uuid, lease_until timestamptz(3), completed_at timestamptz(3), created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX email_jobs_claim_idx ON email_jobs(status,available_at,lease_until);
UPDATE notifications SET email_status='FAILED' WHERE email_status='PENDING';
-- +goose Down
DROP TABLE email_jobs;
DROP TABLE notification_counters;
DROP INDEX notifications_sequence_idx;
ALTER TABLE notifications DROP COLUMN sequence;
ALTER TABLE auth_refresh_tokens DROP CONSTRAINT refresh_tokens_family_fk;
DROP TABLE refresh_families;
