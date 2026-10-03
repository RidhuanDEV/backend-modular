# Setup
JDK25, Maven Wrapper3.9.16, PostgreSQL18 or MySQL8.4. Build does not require database. Initialize/generate-module exit before Spring creates DataSource/JPA/Redis.
Use README commands in order: build, initialize, provision DB, migrate, explicit seed, HTTP, optional separate worker. Initialize accepts --db.provider and --port. Local dotenv optional with full env supplied; malformed dotenv fails. Never log secrets.
DB fields are separate; password never enters JDBC URL. PostgreSQL database/user max63 ASCII; MySQL database64/user32. Production requires explicit exact CORS origins, strong credentials and JWT secret. .env defaults are local examples.
CORS credentials=false; headers Authorization, Content-Type, Accept, Last-Event-ID, X-Request-ID. Expose X-Next-Cursor/X-Request-ID. Rejected origins get no permissive header; requests without Origin work.
