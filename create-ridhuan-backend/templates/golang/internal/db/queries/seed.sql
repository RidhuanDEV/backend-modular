-- name: SeedRole :exec
INSERT INTO roles(name) VALUES($1) ON CONFLICT(name) DO NOTHING;
-- name: SeedPermission :exec
INSERT INTO permissions(name) VALUES($1) ON CONFLICT(name) DO NOTHING;
-- name: SeedAdminPermissions :exec
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='admin' ON CONFLICT DO NOTHING;
-- name: SeedUser :exec
INSERT INTO users(email,password,role_id) SELECT lower($1),$2,id FROM roles WHERE name=$3 ON CONFLICT(email) DO UPDATE SET role_id=EXCLUDED.role_id,deleted_at=NULL,updated_at=now();
