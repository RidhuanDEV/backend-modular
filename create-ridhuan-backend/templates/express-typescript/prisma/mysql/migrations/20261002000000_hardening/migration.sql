-- AlterTable
ALTER TABLE `Notification` ADD COLUMN `sequence` BIGINT NULL;

-- CreateTable
CREATE TABLE `RefreshFamily` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RefreshFamily_expiresAt_revokedAt_idx`(`expiresAt`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `NotificationCounter` (
    `recipientId` CHAR(36) NOT NULL,
    `sequence` BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`recipientId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `EmailJob` (
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

    UNIQUE INDEX `EmailJob_notificationId_key`(`notificationId`),
    INDEX `EmailJob_status_availableAt_leaseUntil_idx`(`status`, `availableAt`, `leaseUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateIndex
CREATE UNIQUE INDEX `Notification_recipientId_sequence_key` ON `Notification`(`recipientId`, `sequence`);

-- Backfill before enforcing foreign keys and required sequence.
INSERT INTO `RefreshFamily` (`id`,`userId`,`expiresAt`,`revokedAt`,`createdAt`) SELECT `familyId`,`userId`,MAX(`expiresAt`),CASE WHEN SUM(CASE WHEN `revokedAt` IS NULL THEN 1 ELSE 0 END)=0 THEN MAX(`revokedAt`) ELSE NULL END,MIN(`createdAt`) FROM `RefreshToken` GROUP BY `familyId`,`userId`;
UPDATE `Notification` AS n JOIN (SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `recipientId` ORDER BY `createdAt`,`id`) AS seq FROM `Notification`) AS r ON n.id=r.id SET n.`sequence`=r.seq;
ALTER TABLE `Notification` MODIFY `sequence` BIGINT NOT NULL;
INSERT INTO `NotificationCounter` (`recipientId`,`sequence`) SELECT `recipientId`,MAX(`sequence`) FROM `Notification` GROUP BY `recipientId`;
UPDATE `Notification` SET `emailStatus` = 'FAILED' WHERE `emailStatus` = 'PENDING';

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `RefreshFamily`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshFamily` ADD CONSTRAINT `RefreshFamily_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationCounter` ADD CONSTRAINT `NotificationCounter_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailJob` ADD CONSTRAINT `EmailJob_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
