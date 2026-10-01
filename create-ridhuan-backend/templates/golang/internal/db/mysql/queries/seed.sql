-- name: SeedRole :exec
INSERT INTO roles(name) VALUES(?) ON DUPLICATE KEY UPDATE name=name;
-- name: SeedPermission :exec
INSERT INTO permissions(name) VALUES(?) ON DUPLICATE KEY UPDATE name=name;
-- name: SeedAdminPermissions :exec
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='admin' ON DUPLICATE KEY UPDATE permission_id=permission_id;
-- name: SeedUser :exec
INSERT INTO users(email,password,role_id) SELECT lower(sqlc.arg(email)),sqlc.arg(password),id FROM roles WHERE name=sqlc.arg(name) ON DUPLICATE KEY UPDATE role_id=VALUES(role_id),deleted_at=NULL,updated_at=CURRENT_TIMESTAMP(3);
