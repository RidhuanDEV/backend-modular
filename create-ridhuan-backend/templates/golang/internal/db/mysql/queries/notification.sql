-- name: CreateNotification :exec
INSERT INTO notifications(id,recipient_id,actor_id,title,body,email_status) VALUES(?,?,?,?,?,?);
-- name: FindNotification :one
SELECT * FROM notifications WHERE id=?;
-- name: LockOwnNotification :one
SELECT * FROM notifications WHERE id=? AND recipient_id=? FOR UPDATE;
-- name: ListOwnNotifications :many
SELECT * FROM notifications WHERE recipient_id=sqlc.arg(recipient_id) AND (CAST(sqlc.arg(unread) AS SIGNED)=0 OR read_at IS NULL) ORDER BY created_at DESC,id DESC LIMIT 50;
-- name: ReadNotification :exec
UPDATE notifications SET read_at=coalesce(read_at,CURRENT_TIMESTAMP(3)) WHERE id=?;
-- name: SetNotificationEmailStatus :exec
UPDATE notifications SET email_status=sqlc.arg(email_status) WHERE id=sqlc.arg(id);
