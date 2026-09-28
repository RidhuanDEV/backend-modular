-- name: InsertAudit :exec
INSERT INTO activity_logs(behavior,module,entity_id,user_id,actor_id_snapshot,before,after,request_id,endpoint_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9);
