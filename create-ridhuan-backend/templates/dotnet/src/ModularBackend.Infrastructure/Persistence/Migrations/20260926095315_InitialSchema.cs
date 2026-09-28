using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ModularBackend.Infrastructure.Persistence.Migrations;

/// <inheritdoc />
public partial class InitialSchema : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "cache_generation",
            columns: table => new
            {
                Id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                Version = table.Column<long>(type: "bigint", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_cache_generation", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "permissions",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_permissions", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "roles",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                Name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_roles", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "role_permissions",
            columns: table => new
            {
                RoleId = table.Column<Guid>(type: "uuid", nullable: false),
                PermissionId = table.Column<Guid>(type: "uuid", nullable: false)
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
            });

        migrationBuilder.CreateTable(
            name: "users",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                Email = table.Column<string>(type: "text", nullable: false),
                PasswordHash = table.Column<string>(type: "text", nullable: false),
                RoleId = table.Column<Guid>(type: "uuid", nullable: false),
                DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
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
            });

        migrationBuilder.CreateTable(
            name: "activity_logs",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                UserId = table.Column<Guid>(type: "uuid", nullable: true),
                ActorIdSnapshot = table.Column<Guid>(type: "uuid", nullable: true),
                ActorEmailSnapshot = table.Column<string>(type: "text", nullable: true),
                Module = table.Column<string>(type: "text", nullable: false),
                Behavior = table.Column<string>(type: "text", nullable: false),
                EntityId = table.Column<Guid>(type: "uuid", nullable: true),
                EndpointId = table.Column<string>(type: "text", nullable: false),
                RequestId = table.Column<string>(type: "text", nullable: false),
                Before = table.Column<string>(type: "jsonb", nullable: true),
                After = table.Column<string>(type: "jsonb", nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
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
            });

        migrationBuilder.CreateTable(
            name: "stored_files",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                Storage = table.Column<string>(type: "text", nullable: false),
                ObjectKey = table.Column<string>(type: "text", nullable: false),
                OriginalName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                MimeType = table.Column<string>(type: "text", nullable: false),
                Size = table.Column<long>(type: "bigint", nullable: false),
                UploaderId = table.Column<Guid>(type: "uuid", nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
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
            });

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
            name: "IX_permissions_Name",
            table: "permissions",
            column: "Name",
            unique: true);

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
