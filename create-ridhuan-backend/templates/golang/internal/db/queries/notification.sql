-- name: CreateNotification :exec
INSERT INTO notifications(id,recipient_id,actor_id,title,body,email_status) VALUES($1,$2,$3,$4,$5,$6);
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
