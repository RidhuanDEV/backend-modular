using System;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.EntityFrameworkCore.Metadata;

#nullable disable

namespace ModularBackend.Infrastructure.Persistence.MySqlMigrations;

/// <inheritdoc />
public partial class InitialMySqlSchema : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "cache_generation",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                Version = table.Column<long>(type: "bigint", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_cache_generation", x => x.Id);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.CreateTable(
            name: "permissions",
            columns: table => new
            {
                Id = table.Column<string>(type: "varchar(36)", nullable: false),
                Name = table.Column<string>(type: "varchar(128)", maxLength: 128, nullable: false),
                CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                UpdatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                Version = table.Column<uint>(type: "int unsigned", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_permissions", x => x.Id);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.CreateTable(
            name: "roles",
            columns: table => new
            {
                Id = table.Column<string>(type: "varchar(36)", nullable: false),
                Name = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                UpdatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                Version = table.Column<uint>(type: "int unsigned", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_roles", x => x.Id);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.CreateTable(
            name: "role_permissions",
            columns: table => new
            {
                RoleId = table.Column<string>(type: "varchar(36)", nullable: false),
                PermissionId = table.Column<string>(type: "varchar(36)", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_role_permissions", x => new { x.RoleId, x.PermissionId });
                table.ForeignKey(
                    name: "FK_role_permissions_permissions_PermissionId",
                    column: x => x.PermissionId,
                    principalTable: "permissions",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_role_permissions_roles_RoleId",
                    column: x => x.RoleId,
                    principalTable: "roles",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.CreateTable(
            name: "users",
            columns: table => new
            {
                Id = table.Column<string>(type: "varchar(36)", nullable: false),
                Email = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: false),
                PasswordHash = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: false),
                RoleId = table.Column<string>(type: "varchar(36)", nullable: false),
                DeletedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                UpdatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                Version = table.Column<uint>(type: "int unsigned", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_users", x => x.Id);
                table.ForeignKey(
                    name: "FK_users_roles_RoleId",
                    column: x => x.RoleId,
                    principalTable: "roles",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.CreateTable(
            name: "activity_logs",
            columns: table => new
            {
                Id = table.Column<string>(type: "varchar(36)", nullable: false),
                UserId = table.Column<string>(type: "varchar(36)", nullable: true),
                ActorIdSnapshot = table.Column<string>(type: "varchar(36)", nullable: true),
                ActorEmailSnapshot = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: true),
                Module = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                Behavior = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                EntityId = table.Column<string>(type: "varchar(36)", nullable: true),
                EndpointId = table.Column<string>(type: "varchar(128)", maxLength: 128, nullable: false),
                RequestId = table.Column<string>(type: "varchar(128)", maxLength: 128, nullable: false),
                Before = table.Column<string>(type: "json", nullable: true),
                After = table.Column<string>(type: "json", nullable: true),
                CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_activity_logs", x => x.Id);
                table.ForeignKey(
                    name: "FK_activity_logs_users_UserId",
                    column: x => x.UserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.SetNull);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.CreateTable(
            name: "notifications",
            columns: table => new
            {
                Id = table.Column<string>(type: "varchar(36)", nullable: false),
                RecipientId = table.Column<string>(type: "varchar(36)", nullable: false),
                ActorId = table.Column<string>(type: "varchar(36)", nullable: true),
                Title = table.Column<string>(type: "varchar(160)", maxLength: 160, nullable: false),
                Body = table.Column<string>(type: "varchar(4000)", maxLength: 4000, nullable: false),
                EmailStatus = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                ReadAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_notifications", x => x.Id);
                table.CheckConstraint("CK_notifications_email_status", "`EmailStatus` IN ('NOT_REQUESTED','PENDING','SENT','FAILED')");
                table.ForeignKey(
                    name: "FK_notifications_users_ActorId",
                    column: x => x.ActorId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.SetNull);
                table.ForeignKey(
                    name: "FK_notifications_users_RecipientId",
                    column: x => x.RecipientId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.CreateTable(
            name: "refresh_tokens",
            columns: table => new
            {
                Id = table.Column<string>(type: "varchar(36)", nullable: false),
                TokenHash = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                FamilyId = table.Column<string>(type: "varchar(36)", nullable: false),
                UserId = table.Column<string>(type: "varchar(36)", nullable: false),
                CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                ExpiresAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                FamilyExpiresAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                RevokedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                ReplacedByTokenHash = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_refresh_tokens", x => x.Id);
                table.ForeignKey(
                    name: "FK_refresh_tokens_users_UserId",
                    column: x => x.UserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.CreateTable(
            name: "stored_files",
            columns: table => new
            {
                Id = table.Column<string>(type: "varchar(36)", nullable: false),
                Storage = table.Column<string>(type: "longtext", nullable: false),
                ObjectKey = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: false),
                OriginalName = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: false),
                MimeType = table.Column<string>(type: "longtext", nullable: false),
                Size = table.Column<long>(type: "bigint", nullable: false),
                UploaderId = table.Column<string>(type: "varchar(36)", nullable: true),
                CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_stored_files", x => x.Id);
                table.ForeignKey(
                    name: "FK_stored_files_users_UploaderId",
                    column: x => x.UploaderId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.SetNull);
            })
            .Annotation("Relational:Collation", "utf8mb4_bin");

        migrationBuilder.InsertData(
            table: "cache_generation",
            columns: new[] { "Id", "Version" },
            values: new object[] { 1, 0L });

        migrationBuilder.CreateIndex(
            name: "IX_activity_logs_CreatedAt",
            table: "activity_logs",
            column: "CreatedAt");

        migrationBuilder.CreateIndex(
            name: "IX_activity_logs_EndpointId_CreatedAt",
            table: "activity_logs",
            columns: new[] { "EndpointId", "CreatedAt" });

        migrationBuilder.CreateIndex(
            name: "IX_activity_logs_Module_EntityId_CreatedAt",
            table: "activity_logs",
            columns: new[] { "Module", "EntityId", "CreatedAt" });

        migrationBuilder.CreateIndex(
            name: "IX_activity_logs_RequestId",
            table: "activity_logs",
            column: "RequestId");

        migrationBuilder.CreateIndex(
            name: "IX_activity_logs_UserId_CreatedAt",
            table: "activity_logs",
            columns: new[] { "UserId", "CreatedAt" });

        migrationBuilder.CreateIndex(
            name: "IX_notifications_ActorId",
            table: "notifications",
            column: "ActorId");

        migrationBuilder.CreateIndex(
            name: "IX_notifications_RecipientId_CreatedAt_Id",
            table: "notifications",
            columns: new[] { "RecipientId", "CreatedAt", "Id" });

        migrationBuilder.CreateIndex(
            name: "IX_permissions_Name",
            table: "permissions",
            column: "Name",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_refresh_tokens_FamilyId_RevokedAt",
            table: "refresh_tokens",
            columns: new[] { "FamilyId", "RevokedAt" });

        migrationBuilder.CreateIndex(
            name: "IX_refresh_tokens_TokenHash",
            table: "refresh_tokens",
            column: "TokenHash",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_refresh_tokens_UserId_ExpiresAt",
            table: "refresh_tokens",
            columns: new[] { "UserId", "ExpiresAt" });

        migrationBuilder.CreateIndex(
            name: "IX_role_permissions_PermissionId",
            table: "role_permissions",
            column: "PermissionId");

        migrationBuilder.CreateIndex(
            name: "IX_roles_Name",
            table: "roles",
            column: "Name",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_stored_files_CreatedAt",
            table: "stored_files",
            column: "CreatedAt");

        migrationBuilder.CreateIndex(
            name: "IX_stored_files_ObjectKey",
            table: "stored_files",
            column: "ObjectKey",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_stored_files_UploaderId_CreatedAt",
            table: "stored_files",
            columns: new[] { "UploaderId", "CreatedAt" });

        migrationBuilder.CreateIndex(
            name: "IX_users_Email",
            table: "users",
            column: "Email",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_users_RoleId",
            table: "users",
            column: "RoleId");
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "activity_logs");

        migrationBuilder.DropTable(
            name: "cache_generation");

        migrationBuilder.DropTable(
            name: "notifications");

        migrationBuilder.DropTable(
            name: "refresh_tokens");

        migrationBuilder.DropTable(
            name: "role_permissions");

        migrationBuilder.DropTable(
            name: "stored_files");

        migrationBuilder.DropTable(
            name: "permissions");

        migrationBuilder.DropTable(
            name: "users");

        migrationBuilder.DropTable(
            name: "roles");
    }
}
