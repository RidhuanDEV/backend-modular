using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using ModularBackend.Domain;

namespace ModularBackend.Infrastructure.Persistence;

public sealed class BackendDbContext(DbContextOptions<BackendDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<Permission> Permissions => Set<Permission>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<ActivityLog> ActivityLogs => Set<ActivityLog>();
    public DbSet<StoredFile> StoredFiles => Set<StoredFile>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<CacheGeneration> CacheGenerations => Set<CacheGeneration>();
    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<CacheGeneration>(b => { b.ToTable("cache_generation"); b.HasKey(x => x.Id); b.HasData(new CacheGeneration { Id = 1, Version = 0 }); });
        model.Entity<User>(b => { b.ToTable("users"); b.HasKey(x => x.Id); b.Property(x => x.Email).IsRequired(); b.Property(x => x.PasswordHash).IsRequired(); b.HasIndex(x => x.Email).IsUnique(); b.HasIndex(x => x.RoleId); b.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Restrict); b.HasQueryFilter(x => x.DeletedAt == null); b.Property(x => x.Version).IsRowVersion(); });
        model.Entity<Role>(b => { b.ToTable("roles"); b.HasKey(x => x.Id); b.Property(x => x.Name).HasMaxLength(64).IsRequired(); b.HasIndex(x => x.Name).IsUnique(); b.Property(x => x.Version).IsRowVersion(); });
        model.Entity<Permission>(b => { b.ToTable("permissions"); b.HasKey(x => x.Id); b.Property(x => x.Name).HasMaxLength(128).IsRequired(); b.HasIndex(x => x.Name).IsUnique(); b.Property(x => x.Version).IsRowVersion(); });
        model.Entity<RolePermission>(b => { b.ToTable("role_permissions"); b.HasKey(x => new { x.RoleId, x.PermissionId }); b.HasOne(x => x.Role).WithMany(x => x.Permissions).HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Cascade); b.HasOne(x => x.Permission).WithMany().HasForeignKey(x => x.PermissionId).OnDelete(DeleteBehavior.Cascade); b.HasIndex(x => x.PermissionId); });
        model.Entity<ActivityLog>(b => { b.ToTable("activity_logs"); b.HasKey(x => x.Id); b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull); b.Property(x => x.Before).HasColumnType("jsonb"); b.Property(x => x.After).HasColumnType("jsonb"); b.HasIndex(x => new { x.Module, x.EntityId, x.CreatedAt }); b.HasIndex(x => new { x.UserId, x.CreatedAt }); b.HasIndex(x => new { x.EndpointId, x.CreatedAt }); b.HasIndex(x => x.RequestId); b.HasIndex(x => x.CreatedAt); });
        model.Entity<StoredFile>(b => { b.ToTable("stored_files"); b.HasIndex(x => x.CreatedAt); b.HasKey(x => x.Id); b.HasIndex(x => x.ObjectKey).IsUnique(); b.Property(x => x.OriginalName).HasMaxLength(255); b.HasOne<User>().WithMany().HasForeignKey(x => x.UploaderId).OnDelete(DeleteBehavior.SetNull); b.HasIndex(x => new { x.UploaderId, x.CreatedAt }); });
        model.Entity<RefreshToken>(b => { b.ToTable("refresh_tokens"); b.HasKey(x => x.Id); b.Property(x => x.TokenHash).HasMaxLength(64).IsRequired(); b.Property(x => x.ReplacedByTokenHash).HasMaxLength(64); b.HasIndex(x => x.TokenHash).IsUnique(); b.HasIndex(x => new { x.FamilyId, x.RevokedAt }); b.HasIndex(x => new { x.UserId, x.ExpiresAt }); b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade); });
        model.Entity<Notification>(b => { b.ToTable("notifications", t => t.HasCheckConstraint("CK_notifications_email_status", "\"EmailStatus\" IN ('NOT_REQUESTED','PENDING','SENT','FAILED')")); b.HasKey(x => x.Id); b.Property(x => x.Title).HasMaxLength(160).IsRequired(); b.Property(x => x.Body).HasMaxLength(4000).IsRequired(); b.Property(x => x.EmailStatus).HasMaxLength(16).IsRequired(); b.HasOne<User>().WithMany().HasForeignKey(x => x.RecipientId).OnDelete(DeleteBehavior.Cascade); b.HasOne<User>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.SetNull); b.HasIndex(x => new { x.RecipientId, x.CreatedAt, x.Id }); });
        foreach (var entity in model.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
                if (property.ClrType == typeof(DateTimeOffset) || property.ClrType == typeof(DateTimeOffset?)) property.SetColumnType("timestamp with time zone");
    }
}
public sealed class BackendDesignFactory : IDesignTimeDbContextFactory<BackendDbContext>
{
    public BackendDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<BackendDbContext>().UseNpgsql(Environment.GetEnvironmentVariable("Database__ConnectionString") ?? "Host=localhost;Database=modular_net_design;Username=postgres;Password=design-only").Options);
}
