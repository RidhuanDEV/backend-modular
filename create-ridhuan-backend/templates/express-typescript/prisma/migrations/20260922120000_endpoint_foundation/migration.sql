-- Existing timestamp values are interpreted as UTC. Verify this assumption before production deployment.
DROP INDEX "Role_name_idx";
DROP INDEX "Permission_name_idx";
DROP INDEX "User_email_idx";
ALTER TABLE "Role"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "Permission"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "User"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(3) USING "deletedAt" AT TIME ZONE 'UTC';

CREATE FUNCTION audit_legacy_json(value TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('_legacy', value);
END;
$$;

ALTER TABLE "CrudAuditLog"
  ALTER COLUMN "before" TYPE JSONB USING audit_legacy_json("before"),
  ALTER COLUMN "after" TYPE JSONB USING audit_legacy_json("after"),
  ALTER COLUMN "entityId" DROP NOT NULL,
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ADD COLUMN "endpointId" TEXT,
  ADD COLUMN "actorIdSnapshot" TEXT;
ALTER TABLE "CrudAuditLog" RENAME COLUMN "action" TO "behavior";
UPDATE "CrudAuditLog" SET "actorIdSnapshot" = "userId";
DROP FUNCTION audit_legacy_json(TEXT);
CREATE FUNCTION audit_redact(value JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB := '{}'::jsonb; entry RECORD; element JSONB;
BEGIN
  IF jsonb_typeof(value) = 'object' THEN
    FOR entry IN SELECT key, value FROM jsonb_each(value) LOOP
      IF entry.key ~* '(password|token|authorization|secret|api.?key|credential|cookie)' THEN
        result := result || jsonb_build_object(entry.key, '[REDACTED]');
      ELSE
        result := result || jsonb_build_object(entry.key, audit_redact(entry.value));
      END IF;
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(value) = 'array' THEN
    result := '[]'::jsonb;
    FOR element IN SELECT jsonb_array_elements(value) LOOP
      result := result || jsonb_build_array(audit_redact(element));
    END LOOP;
    RETURN result;
  END IF;
  RETURN value;
END;
$$;
UPDATE "CrudAuditLog" SET "before" = audit_redact("before"), "after" = audit_redact("after");
DROP FUNCTION audit_redact(JSONB);
ALTER TABLE "CrudAuditLog" DROP COLUMN "updatedAt";
DROP INDEX "CrudAuditLog_module_entityId_idx";
DROP INDEX "CrudAuditLog_userId_idx";
CREATE INDEX "CrudAuditLog_module_entityId_createdAt_idx" ON "CrudAuditLog"("module", "entityId", "createdAt");
CREATE INDEX "CrudAuditLog_userId_createdAt_idx" ON "CrudAuditLog"("userId", "createdAt");
CREATE INDEX "CrudAuditLog_endpointId_createdAt_idx" ON "CrudAuditLog"("endpointId", "createdAt");

CREATE TABLE "StoredFile" (
  "id" TEXT NOT NULL,
  "storage" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "objectKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "uploaderId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoredFile_objectKey_key" ON "StoredFile"("objectKey");
CREATE INDEX "StoredFile_uploaderId_createdAt_idx" ON "StoredFile"("uploaderId", "createdAt");
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_uploaderId_fkey"
  FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
