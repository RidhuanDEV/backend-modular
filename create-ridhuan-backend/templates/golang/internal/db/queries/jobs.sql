
-- name: EnqueueEmail :exec
INSERT INTO email_jobs(id,notification_id,recipient,title,body) VALUES(sqlc.arg(id),sqlc.arg(notification_id),sqlc.arg(recipient),sqlc.arg(title),sqlc.arg(body));
-- name: EmailBacklogCount :one
SELECT count(*)::bigint FROM email_jobs WHERE status IN ('PENDING','PROCESSING');
-- name: EmailBacklogOldest :one
SELECT coalesce(min(created_at),now())::timestamptz FROM email_jobs WHERE status IN ('PENDING','PROCESSING');
-- name: ClaimableEmail :one
SELECT * FROM email_jobs WHERE (status='PENDING' AND available_at <= sqlc.arg(now)::timestamptz(3))
 OR (status='PROCESSING' AND lease_until <= sqlc.arg(now)::timestamptz(3))
 ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
-- name: ClaimEmail :exec
UPDATE email_jobs SET status='PROCESSING',attempts=attempts+1,lease_id=sqlc.arg(lease_id),lease_until=sqlc.arg(lease_until) WHERE id=sqlc.arg(id);
-- name: RenewEmail :execrows
UPDATE email_jobs SET lease_until=sqlc.arg(lease_until) WHERE id=sqlc.arg(id) AND lease_id=sqlc.arg(lease_id) AND status='PROCESSING' AND lease_until > now();
-- name: LockEmail :one
SELECT * FROM email_jobs WHERE id=sqlc.arg(id) FOR UPDATE;
-- name: CompleteEmail :exec
UPDATE email_jobs SET status=sqlc.arg(status),available_at=sqlc.arg(available_at),completed_at=sqlc.narg(completed_at),lease_id=NULL,lease_until=NULL WHERE id=sqlc.arg(id);
-- name: CleanupFamilies :many
SELECT id FROM refresh_families WHERE revoked_at < sqlc.arg(cutoff) OR (revoked_at IS NULL AND expires_at < sqlc.arg(cutoff)) ORDER BY id LIMIT sqlc.arg(batch_size)::int FOR UPDATE SKIP LOCKED;
-- name: CleanupEmail :many
SELECT id FROM email_jobs WHERE status IN ('SENT','FAILED') AND completed_at < sqlc.arg(cutoff) ORDER BY id LIMIT sqlc.arg(batch_size)::int FOR UPDATE SKIP LOCKED;
-- name: CleanupAudit :many
SELECT id FROM activity_logs WHERE created_at < sqlc.arg(cutoff) ORDER BY id LIMIT sqlc.arg(batch_size)::int FOR UPDATE SKIP LOCKED;
-- name: DeleteFamily :exec
DELETE FROM refresh_families WHERE id=sqlc.arg(id);
-- name: DeleteEmail :exec
DELETE FROM email_jobs WHERE id=sqlc.arg(id);
-- name: DeleteAudit :exec
DELETE FROM activity_logs WHERE id=sqlc.arg(id);
