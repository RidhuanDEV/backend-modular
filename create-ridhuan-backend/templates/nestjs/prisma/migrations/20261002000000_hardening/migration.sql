-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "sequence" BIGINT NULL;

-- CreateTable
CREATE TABLE "refresh_families" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_counters" (
    "recipientId" UUID NOT NULL,
    "sequence" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "notification_counters_pkey" PRIMARY KEY ("recipientId")
);

-- CreateTable
CREATE TABLE "email_jobs" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "leaseId" UUID,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id")
);

-- Backfill before enforcing foreign keys and required sequence.
INSERT INTO "refresh_families" ("id","userId","expiresAt","revokedAt","createdAt") SELECT "familyId","userId",MAX("expiresAt"),CASE WHEN SUM(CASE WHEN "revokedAt" IS NULL THEN 1 ELSE 0 END)=0 THEN MAX("revokedAt") ELSE NULL END,MIN("createdAt") FROM "refresh_tokens" GROUP BY "familyId","userId";
UPDATE "notifications" AS n SET "sequence"=r.seq FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "recipientId" ORDER BY "createdAt","id") AS seq FROM "notifications") AS r WHERE n.id=r.id;
ALTER TABLE "notifications" ALTER COLUMN "sequence" SET NOT NULL;
INSERT INTO "notification_counters" ("recipientId","sequence") SELECT "recipientId",MAX("sequence") FROM "notifications" GROUP BY "recipientId";
UPDATE "notifications" SET "emailStatus" = 'FAILED' WHERE "emailStatus" = 'PENDING';

-- CreateIndex
CREATE INDEX "refresh_families_expiresAt_revokedAt_idx" ON "refresh_families"("expiresAt", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_jobs_notificationId_key" ON "email_jobs"("notificationId");

-- CreateIndex
CREATE INDEX "email_jobs_status_availableAt_leaseUntil_idx" ON "email_jobs"("status", "availableAt", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipientId_sequence_key" ON "notifications"("recipientId", "sequence");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "refresh_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_families" ADD CONSTRAINT "refresh_families_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_counters" ADD CONSTRAINT "notification_counters_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
