-- +goose Up
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title varchar(160) NOT NULL,
  body varchar(4000) NOT NULL,
  email_status text NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (email_status IN ('NOT_REQUESTED','PENDING','SENT','FAILED')),
  read_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient_created_idx ON notifications(recipient_id, created_at DESC, id DESC);
-- +goose Down
DROP TABLE notifications;
