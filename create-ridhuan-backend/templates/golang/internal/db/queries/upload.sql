-- name: FindFile :one
SELECT * FROM stored_files WHERE id=$1 AND status='READY';
-- name: CreateFile :one
INSERT INTO stored_files(storage,object_key,original_name,mime_type,size,uploader_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *;
-- name: FileReferenced :one
SELECT EXISTS(SELECT 1 FROM stored_files WHERE object_key=$1 AND storage=$2);
