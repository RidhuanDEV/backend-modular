-- name: InsertAudit :exec
INSERT INTO activity_logs(behavior,module,entity_id,user_id,actor_id_snapshot,`before`,`after`,request_id,endpoint_id) VALUES(?,?,?,?,?,?,?,?,?);
