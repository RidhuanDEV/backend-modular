using Microsoft.EntityFrameworkCore;
using ModularBackend.Domain;
using ModularBackend.Infrastructure.Persistence;
using ModularBackend.Infrastructure.Security;

if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("Database__ConnectionString")))
    throw new InvalidOperationException("Database__ConnectionString required");
await using var db = new BackendDesignFactory().CreateDbContext(args);
using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
var ct = timeout.Token;
await using var tx = await db.Database.BeginTransactionAsync(
    System.Data.IsolationLevel.Serializable,
    ct
);
var now = TimeProvider.System.GetUtcNow();
foreach (var name in new[] { "admin", "user" })
    if (!await db.Roles.AnyAsync(r => r.Name == name, ct))
        db.Roles.Add(
            new Role
            {
                Name = name,
                CreatedAt = now,
                UpdatedAt = now,
            }
        );
foreach (
    var name in new[]
    {
        "manage_users",
        "manage_roles",
        "manage_permissions",
        "manage_uploads",
        "manage_notifications",
    }
)
    if (!await db.Permissions.AnyAsync(p => p.Name == name, ct))
        db.Permissions.Add(
            new Permission
            {
                Name = name,
                CreatedAt = now,
                UpdatedAt = now,
            }
        );
await db.SaveChangesAsync(ct);
var admin = await db.Roles.Include(r => r.Permissions).SingleAsync(r => r.Name == "admin", ct);
foreach (var p in await db.Permissions.ToArrayAsync(ct))
    if (admin.Permissions.All(g => g.PermissionId != p.Id))
        admin.Permissions.Add(
            new RolePermission
            {
                Role = admin,
                RoleId = admin.Id,
                Permission = p,
                PermissionId = p.Id,
            }
        );
var email = Environment.GetEnvironmentVariable("Bootstrap__Email");
var password = Environment.GetEnvironmentVariable("Bootstrap__Password");
if (
    !string.IsNullOrWhiteSpace(email)
    && !string.IsNullOrWhiteSpace(password)
    && !await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email == email, ct)
)
{
    if (password.Length < 12)
        throw new InvalidOperationException("Bootstrap password requires 12 characters");
    if (password.Contains("CHANGE_ME", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException(
            "Bootstrap password must be generated; the template placeholder is public"
        );
    var user = new User
    {
        Email = email,
        PasswordHash = "",
        Role = admin,
        RoleId = admin.Id,
        CreatedAt = now,
        UpdatedAt = now,
    };
    user.PasswordHash = new PasswordService().Hash(user, password);
    db.Users.Add(user);
}
await db.SaveChangesAsync(ct);
await db
    .CacheGenerations.Where(x => x.Id == 1)
    .ExecuteUpdateAsync(s => s.SetProperty(x => x.Version, x => x.Version + 1), ct);
await tx.CommitAsync(ct);
Console.WriteLine("Idempotent seed complete; existing account passwords preserved");
