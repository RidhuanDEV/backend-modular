-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "sequence" BIGINT NULL;

-- CreateTable
CREATE TABLE "RefreshFamily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCounter" (
    "recipientId" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "NotificationCounter_pkey" PRIMARY KEY ("recipientId")
);

-- CreateTable
CREATE TABLE "EmailJob" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "leaseId" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailJob_pkey" PRIMARY KEY ("id")
);

-- Backfill before enforcing foreign keys and required sequence.
INSERT INTO "RefreshFamily" ("id","userId","expiresAt","revokedAt","createdAt") SELECT "familyId","userId",MAX("expiresAt"),CASE WHEN SUM(CASE WHEN "revokedAt" IS NULL THEN 1 ELSE 0 END)=0 THEN MAX("revokedAt") ELSE NULL END,MIN("createdAt") FROM "RefreshToken" GROUP BY "familyId","userId";
UPDATE "Notification" AS n SET "sequence"=r.seq FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "recipientId" ORDER BY "createdAt","id") AS seq FROM "Notification") AS r WHERE n.id=r.id;
ALTER TABLE "Notification" ALTER COLUMN "sequence" SET NOT NULL;
INSERT INTO "NotificationCounter" ("recipientId","sequence") SELECT "recipientId",MAX("sequence") FROM "Notification" GROUP BY "recipientId";
UPDATE "Notification" SET "emailStatus" = 'FAILED' WHERE "emailStatus" = 'PENDING';

-- CreateIndex
CREATE INDEX "RefreshFamily_expiresAt_revokedAt_idx" ON "RefreshFamily"("expiresAt", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailJob_notificationId_key" ON "EmailJob"("notificationId");

-- CreateIndex
CREATE INDEX "EmailJob_status_availableAt_leaseUntil_idx" ON "EmailJob"("status", "availableAt", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_recipientId_sequence_key" ON "Notification"("recipientId", "sequence");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "RefreshFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshFamily" ADD CONSTRAINT "RefreshFamily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCounter" ADD CONSTRAINT "NotificationCounter_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
