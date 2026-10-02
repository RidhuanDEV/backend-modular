using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ModularBackend.Infrastructure.Persistence.MySqlMigrations;

/// <inheritdoc />
public partial class Hardening : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<long>(
            name: "Sequence",
            table: "notifications",
            type: "bigint",
            nullable: false,
            defaultValue: 0L);

        migrationBuilder.CreateTable(
            name: "email_jobs",
            columns: table => new
            {
                Id = table.Column<string>(type: "varchar(36)", nullable: false),
                NotificationId = table.Column<string>(type: "varchar(36)", nullable: false),
                Recipient = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: false),
                Title = table.Column<string>(type: "varchar(160)", maxLength: 160, nullable: false),
                Body = table.Column<string>(type: "varchar(4000)", maxLength: 4000, nullable: false),
                Status = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                Attempts = table.Column<int>(type: "int", nullable: false),
                AvailableAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                LeaseId = table.Column<string>(type: "varchar(36)", nullable: true),
                LeaseUntil = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                CompletedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_email_jobs", x => x.Id);
                table.ForeignKey(
                    name: "FK_email_jobs_notifications_NotificationId",
                    column: x => x.NotificationId,
                    principalTable: "notifications",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.CreateTable(
            name: "notification_counters",
            columns: table => new
            {
                RecipientId = table.Column<string>(type: "varchar(36)", nullable: false),
                Sequence = table.Column<long>(type: "bigint", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_notification_counters", x => x.RecipientId);
                table.ForeignKey(
                    name: "FK_notification_counters_users_RecipientId",
                    column: x => x.RecipientId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.CreateTable(
            name: "refresh_families",
            columns: table => new
            {
                Id = table.Column<string>(type: "varchar(36)", nullable: false),
                UserId = table.Column<string>(type: "varchar(36)", nullable: false),
                CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                ExpiresAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                RevokedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_refresh_families", x => x.Id);
                table.ForeignKey(
                    name: "FK_refresh_families_users_UserId",
                    column: x => x.UserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.Sql("""
INSERT INTO refresh_families(`Id`,`UserId`,`CreatedAt`,`ExpiresAt`,`RevokedAt`) SELECT `FamilyId`,`UserId`,MIN(`CreatedAt`),MAX(`ExpiresAt`),CASE WHEN SUM(CASE WHEN `RevokedAt` IS NULL THEN 1 ELSE 0 END)=0 THEN MAX(`RevokedAt`) ELSE NULL END FROM refresh_tokens GROUP BY `FamilyId`,`UserId`;
UPDATE notifications n JOIN (SELECT Id,row_number() OVER(PARTITION BY RecipientId ORDER BY CreatedAt,Id) AS sequence FROM notifications) r ON n.Id=r.Id SET n.Sequence=r.sequence;
INSERT INTO notification_counters(`RecipientId`,`Sequence`) SELECT `RecipientId`,MAX(`Sequence`) FROM notifications GROUP BY `RecipientId`;
UPDATE notifications SET `EmailStatus`='FAILED' WHERE `EmailStatus`='PENDING';
""");

        migrationBuilder.CreateIndex(
            name: "IX_notifications_RecipientId_Sequence",
            table: "notifications",
            columns: new[] { "RecipientId", "Sequence" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_email_jobs_NotificationId",
            table: "email_jobs",
            column: "NotificationId",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_email_jobs_Status_AvailableAt_LeaseUntil",
            table: "email_jobs",
            columns: new[] { "Status", "AvailableAt", "LeaseUntil" });

        migrationBuilder.CreateIndex(
            name: "IX_refresh_families_RevokedAt_ExpiresAt",
            table: "refresh_families",
            columns: new[] { "RevokedAt", "ExpiresAt" });

        migrationBuilder.CreateIndex(
            name: "IX_refresh_families_UserId",
            table: "refresh_families",
            column: "UserId");

        migrationBuilder.AddForeignKey(
            name: "FK_refresh_tokens_refresh_families_FamilyId",
            table: "refresh_tokens",
            column: "FamilyId",
            principalTable: "refresh_families",
            principalColumn: "Id",
            onDelete: ReferentialAction.Cascade);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(
            name: "FK_refresh_tokens_refresh_families_FamilyId",
            table: "refresh_tokens");

        migrationBuilder.DropTable(
            name: "email_jobs");

        migrationBuilder.DropTable(
            name: "notification_counters");

        migrationBuilder.DropTable(
            name: "refresh_families");

        migrationBuilder.DropIndex(
            name: "IX_notifications_RecipientId_Sequence",
            table: "notifications");

        migrationBuilder.DropColumn(
            name: "Sequence",
            table: "notifications");
    }
}
