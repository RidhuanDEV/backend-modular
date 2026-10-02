-- name: CreateNotification :exec
INSERT INTO notifications(id,recipient_id,actor_id,title,body,email_status,sequence) VALUES(?,?,?,?,?,?,?);
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

-- name: EnsureNotificationCounter :exec
INSERT INTO notification_counters(recipient_id,sequence) VALUES(sqlc.arg(recipient_id),0)
ON DUPLICATE KEY UPDATE sequence=sequence;
-- name: IncrementNotificationCounter :exec
UPDATE notification_counters SET sequence=sequence+1 WHERE recipient_id=sqlc.arg(recipient_id);
-- name: NotificationSequence :one
SELECT sequence FROM notification_counters WHERE recipient_id=sqlc.arg(recipient_id);
-- name: NotificationCursor :one
SELECT sequence FROM notifications WHERE id=sqlc.arg(id) AND recipient_id=sqlc.arg(recipient_id);
-- name: NotificationBacklog :many
SELECT * FROM notifications WHERE recipient_id=sqlc.arg(recipient_id)
 AND ((CAST(sqlc.arg(has_cursor) AS SIGNED)= 1 AND sequence > sqlc.arg(sequence))
 OR (CAST(sqlc.arg(has_cursor) AS SIGNED)= 0 AND read_at IS NULL))
 AND (CAST(sqlc.arg(unread_only) AS SIGNED)=0 OR read_at IS NULL)
 ORDER BY sequence LIMIT 50;
-- name: NotificationPage :many
SELECT * FROM notifications WHERE recipient_id=sqlc.arg(recipient_id)
 AND (CAST(sqlc.arg(has_cursor) AS SIGNED)= 0 OR sequence < sqlc.arg(sequence))
 ORDER BY sequence DESC LIMIT 51;
