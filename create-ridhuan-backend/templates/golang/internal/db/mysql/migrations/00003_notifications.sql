-- +goose Up
CREATE TABLE notifications (
 id char(36) PRIMARY KEY DEFAULT (uuid()), recipient_id char(36) NOT NULL, actor_id char(36), title varchar(160) NOT NULL, body varchar(4000) NOT NULL,
 email_status varchar(16) NOT NULL DEFAULT 'NOT_REQUESTED' CHECK(email_status IN ('NOT_REQUESTED','PENDING','SENT','FAILED')),
 read_at datetime(3), created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL,
 INDEX notifications_recipient_created_idx(recipient_id,created_at,id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
-- +goose Down
DROP TABLE notifications;
