using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using ModularBackend.Domain;
using MySql.EntityFrameworkCore.Extensions;

namespace ModularBackend.Infrastructure.Persistence;

public class BackendDbContext : DbContext
{
    public BackendDbContext(DbContextOptions<BackendDbContext> options) : base(options) { }
    protected BackendDbContext(DbContextOptions options) : base(options) { }
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<Permission> Permissions => Set<Permission>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<ActivityLog> ActivityLogs => Set<ActivityLog>();
    public DbSet<StoredFile> StoredFiles => Set<StoredFile>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<RefreshFamily> RefreshFamilies => Set<RefreshFamily>();
    public DbSet<NotificationCounter> NotificationCounters => Set<NotificationCounter>();
    public DbSet<EmailJob> EmailJobs => Set<EmailJob>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<CacheGeneration> CacheGenerations => Set<CacheGeneration>();
    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<RefreshFamily>(b => { b.ToTable("refresh_families"); b.HasKey(x => x.Id); b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade); b.HasIndex(x => new { x.RevokedAt, x.ExpiresAt }); });
        model.Entity<RefreshToken>().HasOne<RefreshFamily>().WithMany().HasForeignKey(x => x.FamilyId).OnDelete(DeleteBehavior.Cascade);
        model.Entity<NotificationCounter>(b => { b.ToTable("notification_counters"); b.HasKey(x => x.RecipientId); b.HasOne<User>().WithOne().HasForeignKey<NotificationCounter>(x => x.RecipientId).OnDelete(DeleteBehavior.Cascade); });
        model.Entity<Notification>().HasIndex(x => new { x.RecipientId, x.Sequence }).IsUnique();
        model.Entity<EmailJob>(b => { b.ToTable("email_jobs"); b.HasKey(x => x.Id); b.HasOne<Notification>().WithOne().HasForeignKey<EmailJob>(x => x.NotificationId).OnDelete(DeleteBehavior.Cascade); b.HasIndex(x => x.NotificationId).IsUnique(); b.HasIndex(x => new { x.Status, x.AvailableAt, x.LeaseUntil }); b.Property(x => x.Recipient).HasMaxLength(255).IsRequired(); b.Property(x => x.Title).HasMaxLength(160).IsRequired(); b.Property(x => x.Body).HasMaxLength(4000).IsRequired(); b.Property(x => x.Status).HasMaxLength(16).IsRequired(); });
        model.Entity<CacheGeneration>(b => { b.ToTable("cache_generation"); b.HasKey(x => x.Id); b.HasData(new CacheGeneration { Id = 1, Version = 0 }); });
        model.Entity<User>(b => { b.ToTable("users"); b.HasKey(x => x.Id); b.Property(x => x.Email).IsRequired(); b.Property(x => x.PasswordHash).IsRequired(); b.HasIndex(x => x.Email).IsUnique(); b.HasIndex(x => x.RoleId); b.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Restrict); b.HasQueryFilter(x => x.DeletedAt == null); b.Property(x => x.Version).IsRowVersion(); });
        model.Entity<Role>(b => { b.ToTable("roles"); b.HasKey(x => x.Id); b.Property(x => x.Name).HasMaxLength(64).IsRequired(); b.HasIndex(x => x.Name).IsUnique(); b.Property(x => x.Version).IsRowVersion(); });
        model.Entity<Permission>(b => { b.ToTable("permissions"); b.HasKey(x => x.Id); b.Property(x => x.Name).HasMaxLength(128).IsRequired(); b.HasIndex(x => x.Name).IsUnique(); b.Property(x => x.Version).IsRowVersion(); });
        model.Entity<RolePermission>(b => { b.ToTable("role_permissions"); b.HasKey(x => new { x.RoleId, x.PermissionId }); b.HasOne(x => x.Role).WithMany(x => x.Permissions).HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Cascade); b.HasOne(x => x.Permission).WithMany().HasForeignKey(x => x.PermissionId).OnDelete(DeleteBehavior.Cascade); b.HasIndex(x => x.PermissionId); });
        model.Entity<ActivityLog>(b => { b.ToTable("activity_logs"); b.HasKey(x => x.Id); b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull); b.Property(x => x.Before).HasColumnType("jsonb"); b.Property(x => x.After).HasColumnType("jsonb"); b.HasIndex(x => new { x.Module, x.EntityId, x.CreatedAt }); b.HasIndex(x => new { x.UserId, x.CreatedAt }); b.HasIndex(x => new { x.EndpointId, x.CreatedAt }); b.HasIndex(x => x.RequestId); b.HasIndex(x => x.CreatedAt); });
        model.Entity<StoredFile>(b => { b.ToTable("stored_files"); b.HasIndex(x => x.CreatedAt); b.HasKey(x => x.Id); b.HasIndex(x => x.ObjectKey).IsUnique(); b.Property(x => x.OriginalName).HasMaxLength(255); b.HasOne<User>().WithMany().HasForeignKey(x => x.UploaderId).OnDelete(DeleteBehavior.SetNull); b.HasIndex(x => new { x.UploaderId, x.CreatedAt }); });
        model.Entity<RefreshToken>(b => { b.ToTable("refresh_tokens"); b.HasKey(x => x.Id); b.Property(x => x.TokenHash).HasMaxLength(64).IsRequired(); b.Property(x => x.ReplacedByTokenHash).HasMaxLength(64); b.HasIndex(x => x.TokenHash).IsUnique(); b.HasIndex(x => new { x.FamilyId, x.RevokedAt }); b.HasIndex(x => new { x.UserId, x.ExpiresAt }); b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade); });
        model.Entity<Notification>(b => { b.ToTable("notifications", t => t.HasCheckConstraint("CK_notifications_email_status", Database.IsMySql() ? "`EmailStatus` IN ('NOT_REQUESTED','PENDING','SENT','FAILED')" : "\"EmailStatus\" IN ('NOT_REQUESTED','PENDING','SENT','FAILED')")); b.HasKey(x => x.Id); b.Property(x => x.Title).HasMaxLength(160).IsRequired(); b.Property(x => x.Body).HasMaxLength(4000).IsRequired(); b.Property(x => x.EmailStatus).HasMaxLength(16).IsRequired(); b.HasOne<User>().WithMany().HasForeignKey(x => x.RecipientId).OnDelete(DeleteBehavior.Cascade); b.HasOne<User>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.SetNull); b.HasIndex(x => new { x.RecipientId, x.CreatedAt, x.Id }); });
        if (Database.IsMySql())
        {
            RelationalModelBuilderExtensions.UseCollation(model, "utf8mb4_bin");
            model.Entity<User>().Property(x => x.Email).HasMaxLength(255);
            model.Entity<User>().Property(x => x.PasswordHash).HasMaxLength(255);
            model.Entity<StoredFile>().Property(x => x.ObjectKey).HasMaxLength(255);
            model.Entity<ActivityLog>().Property(x => x.Module).HasMaxLength(64);
            model.Entity<ActivityLog>().Property(x => x.Behavior).HasMaxLength(64);
            model.Entity<ActivityLog>().Property(x => x.EndpointId).HasMaxLength(128);
            model.Entity<ActivityLog>().Property(x => x.RequestId).HasMaxLength(128);
            model.Entity<ActivityLog>().Property(x => x.ActorEmailSnapshot).HasMaxLength(255);
            model.Entity<ActivityLog>().Property(x => x.Before).HasColumnType("json");
            model.Entity<ActivityLog>().Property(x => x.After).HasColumnType("json");
            foreach (var type in new[] { typeof(User), typeof(Role), typeof(Permission) })
            {
                var version = model.Entity(type).Property(nameof(Entity.Version));
                version.IsConcurrencyToken().ValueGeneratedNever();
            }
        }
        var utc = new ValueConverter<DateTimeOffset, DateTime>(instant => instant.UtcDateTime, stored => new DateTimeOffset(DateTime.SpecifyKind(stored, DateTimeKind.Utc)));
        var guid = new ValueConverter<Guid, string>(id => id.ToString("D"), stored => Guid.Parse(stored));
        foreach (var entity in model.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
            {
                if (property.ClrType == typeof(DateTimeOffset) || property.ClrType == typeof(DateTimeOffset?))
                {
                    property.SetColumnType(Database.IsMySql() ? "datetime(6)" : "timestamp with time zone");
                    if (Database.IsMySql()) property.SetValueConverter(utc);
                }
                if (Database.IsMySql() && (property.ClrType == typeof(Guid) || property.ClrType == typeof(Guid?)))
                {
                    property.SetValueConverter(guid);
                    property.SetColumnType("varchar(36)");
                }
            }
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        if (Database.IsMySql())
            foreach (var entry in ChangeTracker.Entries<Entity>().Where(entry => entry.State == EntityState.Modified))
                entry.Entity.Version = checked(entry.Entity.Version + 1);
        return base.SaveChangesAsync(cancellationToken);
    }
}
public sealed class BackendDesignFactory : IDesignTimeDbContextFactory<BackendDbContext>
{
    public BackendDbContext CreateDbContext(string[] args) => DatabaseProvider.Create(Environment.GetEnvironmentVariable("Database__Provider") ?? "postgresql", Environment.GetEnvironmentVariable("Database__ConnectionString") ?? "Host=localhost;Database=modular_net_design;Username=postgres;Password=design-only");
}

public sealed class MySqlBackendDbContext(DbContextOptions<MySqlBackendDbContext> options) : BackendDbContext(options);

public sealed class MySqlDesignFactory : IDesignTimeDbContextFactory<MySqlBackendDbContext>
{
    public MySqlBackendDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<MySqlBackendDbContext>().UseMySQL(Environment.GetEnvironmentVariable("Database__ConnectionString") ?? "Server=localhost;Database=modular_net_design;User ID=root;Password=design-only", options => options.CommandTimeout(10)).AddInterceptors(new MySqlUtcInterceptor()).Options);
}
