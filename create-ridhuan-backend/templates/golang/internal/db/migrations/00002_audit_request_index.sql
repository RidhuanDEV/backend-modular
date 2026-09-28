-- +goose Up
CREATE INDEX activity_logs_request_idx ON activity_logs(request_id, created_at DESC) WHERE request_id IS NOT NULL;

-- +goose Down
DROP INDEX activity_logs_request_idx;
