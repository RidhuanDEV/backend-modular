-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `sequence` BIGINT NULL;

-- CreateTable
CREATE TABLE `refresh_families` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `refresh_families_expiresAt_revokedAt_idx`(`expiresAt`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `notification_counters` (
    `recipientId` CHAR(36) NOT NULL,
    `sequence` BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`recipientId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `email_jobs` (
    `id` CHAR(36) NOT NULL,
    `notificationId` CHAR(36) NOT NULL,
    `recipient` VARCHAR(255) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` VARCHAR(4000) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseUntil` DATETIME(3) NULL,
    `leaseId` CHAR(36) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_jobs_notificationId_key`(`notificationId`),
    INDEX `email_jobs_status_availableAt_leaseUntil_idx`(`status`, `availableAt`, `leaseUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateIndex
CREATE UNIQUE INDEX `notifications_recipientId_sequence_key` ON `notifications`(`recipientId`, `sequence`);

-- Backfill before enforcing foreign keys and required sequence.
INSERT INTO `refresh_families` (`id`,`userId`,`expiresAt`,`revokedAt`,`createdAt`) SELECT `familyId`,`userId`,MAX(`expiresAt`),CASE WHEN SUM(CASE WHEN `revokedAt` IS NULL THEN 1 ELSE 0 END)=0 THEN MAX(`revokedAt`) ELSE NULL END,MIN(`createdAt`) FROM `refresh_tokens` GROUP BY `familyId`,`userId`;
UPDATE `notifications` AS n JOIN (SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `recipientId` ORDER BY `createdAt`,`id`) AS seq FROM `notifications`) AS r ON n.id=r.id SET n.`sequence`=r.seq;
ALTER TABLE `notifications` MODIFY `sequence` BIGINT NOT NULL;
INSERT INTO `notification_counters` (`recipientId`,`sequence`) SELECT `recipientId`,MAX(`sequence`) FROM `notifications` GROUP BY `recipientId`;
UPDATE `notifications` SET `emailStatus` = 'FAILED' WHERE `emailStatus` = 'PENDING';

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `refresh_families`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_families` ADD CONSTRAINT `refresh_families_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_counters` ADD CONSTRAINT `notification_counters_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_jobs` ADD CONSTRAINT `email_jobs_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
