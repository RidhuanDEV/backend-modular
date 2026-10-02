-- name: CreateNotification :exec
INSERT INTO notifications(id,recipient_id,actor_id,title,body,email_status,sequence) VALUES($1,$2,$3,$4,$5,$6,$7);
-- name: FindNotification :one
SELECT * FROM notifications WHERE id=$1;
-- name: LockOwnNotification :one
SELECT * FROM notifications WHERE id=$1 AND recipient_id=$2 FOR UPDATE;
-- name: ListOwnNotifications :many
SELECT * FROM notifications WHERE recipient_id=$1 AND (sqlc.arg(unread)::boolean=false OR read_at IS NULL) ORDER BY created_at DESC,id DESC LIMIT 50;
-- name: ReadNotification :exec
UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1;
-- name: SetNotificationEmailStatus :exec
UPDATE notifications SET email_status=$2 WHERE id=$1;

-- name: EnsureNotificationCounter :exec
INSERT INTO notification_counters(recipient_id,sequence) VALUES(sqlc.arg(recipient_id),0)
ON CONFLICT(recipient_id) DO NOTHING;
-- name: IncrementNotificationCounter :exec
UPDATE notification_counters SET sequence=sequence+1 WHERE recipient_id=sqlc.arg(recipient_id);
-- name: NotificationSequence :one
SELECT sequence FROM notification_counters WHERE recipient_id=sqlc.arg(recipient_id);
-- name: NotificationCursor :one
SELECT sequence FROM notifications WHERE id=sqlc.arg(id) AND recipient_id=sqlc.arg(recipient_id);
-- name: NotificationBacklog :many
SELECT * FROM notifications WHERE recipient_id=sqlc.arg(recipient_id)
 AND ((sqlc.arg(has_cursor)::boolean= true AND sequence > sqlc.arg(sequence)::bigint)
 OR (sqlc.arg(has_cursor)::boolean= false AND read_at IS NULL))
 AND (sqlc.arg(unread_only)::boolean=false OR read_at IS NULL)
 ORDER BY sequence LIMIT 50;
-- name: NotificationPage :many
SELECT * FROM notifications WHERE recipient_id=sqlc.arg(recipient_id)
 AND (sqlc.arg(has_cursor)::boolean= false OR sequence < sqlc.arg(sequence)::bigint)
 ORDER BY sequence DESC LIMIT 51;
