-- name: FindFile :one
SELECT * FROM stored_files WHERE id=? AND status='READY';
-- name: CreateFile :exec
INSERT INTO stored_files(id,storage,object_key,original_name,mime_type,size,uploader_id) VALUES(?,?,?,?,?,?,?);
-- name: FileReferenced :one
SELECT EXISTS(SELECT 1 FROM stored_files WHERE object_key=sqlc.arg(object_key) AND storage=sqlc.arg(storage));
