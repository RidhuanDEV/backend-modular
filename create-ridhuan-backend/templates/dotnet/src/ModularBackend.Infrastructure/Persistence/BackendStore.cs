using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using ModularBackend.Application;
using ModularBackend.Domain;
using Npgsql;

namespace ModularBackend.Infrastructure.Persistence;

public sealed class BackendStore(BackendDbContext db) : IBackendStore
{
    private IDbContextTransaction? transaction;
    private IQueryable<User> Users => db.Users.Include(x => x.Role).ThenInclude(x => x.Permissions).ThenInclude(x => x.Permission);
    private IQueryable<Role> Roles => db.Roles.Include(x => x.Permissions).ThenInclude(x => x.Permission);
    public Task<User?> UserAsync(Guid id, CancellationToken ct) => Users.SingleOrDefaultAsync(x => x.Id == id, ct);
    public Task<User?> UserByEmailAsync(string email, CancellationToken ct) => Users.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.Email == email, ct);
    public Task<Role?> RoleAsync(Guid id, CancellationToken ct) => Roles.SingleOrDefaultAsync(x => x.Id == id, ct);
    public Task<Role?> RoleByNameAsync(string name, CancellationToken ct) => Roles.SingleOrDefaultAsync(x => x.Name == name, ct);
    public Task<Permission?> PermissionAsync(Guid id, CancellationToken ct) => db.Permissions.SingleOrDefaultAsync(x => x.Id == id, ct);
    public async Task<IReadOnlyList<Role>> RolesAsync(CancellationToken ct) => await Roles.OrderBy(x => x.Name).ToArrayAsync(ct);
    public async Task<IReadOnlyList<Permission>> PermissionsAsync(CancellationToken ct) => await db.Permissions.OrderBy(x => x.Name).ToArrayAsync(ct);
    public async Task<(IReadOnlyList<User> Rows, int Total)> UsersAsync(UserQuery query, CancellationToken ct)
    {
        var users = Users;
        if (!string.IsNullOrEmpty(query.Search)) users = users.Where(x => x.Email.ToLower().Contains(query.Search.ToLower()));
        var total = await users.CountAsync(ct);
        var desc = query.OrderBy == "desc";
        users = query.SortBy switch { "email" => desc ? users.OrderByDescending(x => x.Email) : users.OrderBy(x => x.Email), "updatedAt" => desc ? users.OrderByDescending(x => x.UpdatedAt) : users.OrderBy(x => x.UpdatedAt), _ => desc ? users.OrderByDescending(x => x.CreatedAt) : users.OrderBy(x => x.CreatedAt) };
        return (await users.Skip(checked((query.Page - 1) * query.Limit)).Take(query.Limit).ToArrayAsync(ct), total);
    }
    public Task<bool> HasPermissionAsync(Guid userId, string permission, CancellationToken ct) => db.Users.AnyAsync(u => u.Id == userId && u.Role.Permissions.Any(g => g.Permission.Name == permission), ct);
    public Task<bool> HasRoleUsersAsync(Guid roleId, CancellationToken ct) => db.Users.IgnoreQueryFilters().AnyAsync(x => x.RoleId == roleId, ct);
    public Task<StoredFile?> FileAsync(Guid id, CancellationToken ct) => db.StoredFiles.SingleOrDefaultAsync(x => x.Id == id, ct);
    public Task<bool> IsFileReferencedAsync(string objectKey, CancellationToken ct) => db.StoredFiles.AnyAsync(f => f.ObjectKey == objectKey, ct);
    public Task<RefreshToken?> RefreshTokenAsync(string tokenHash, CancellationToken ct) => db.RefreshTokens.SingleOrDefaultAsync(x => x.TokenHash == tokenHash, ct);
    public async Task RevokeRefreshFamilyAsync(Guid familyId, DateTimeOffset revokedAt, CancellationToken ct) => _ = await db.RefreshTokens.Where(x => x.FamilyId == familyId && x.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, revokedAt), ct);
    public void AddUser(User user) => db.Users.Add(user);
    public void AddRole(Role role) => db.Roles.Add(role);
    public void AddPermission(Permission permission) => db.Permissions.Add(permission);
    public void RemoveRole(Role role) => db.Roles.Remove(role);
    public void RemovePermission(Permission permission) => db.Permissions.Remove(permission);
    public void AddFile(StoredFile file) => db.StoredFiles.Add(file);
    public void AddAudit(ActivityLog log) => db.ActivityLogs.Add(log);
    public void AddRefreshToken(RefreshToken token) => db.RefreshTokens.Add(token);
    public async Task BeginAsync(CancellationToken ct) => transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
    public async Task CommitAsync(CancellationToken ct, bool invalidateCache = true)
    {
        await SaveAsync(ct);
        if (transaction is null) throw new InvalidOperationException("No transaction");
        if (invalidateCache) await db.CacheGenerations.Where(x => x.Id == 1).ExecuteUpdateAsync(s => s.SetProperty(x => x.Version, x => x.Version + 1), ct);
        try { await transaction.CommitAsync(ct); } catch (PostgresException ex) when (ex.SqlState == "40001") { throw new ApiException(409, "Concurrent change; retry request"); }
        await transaction.DisposeAsync(); transaction = null;
    }
    public async Task RollbackAsync(CancellationToken ct)
    {
        if (transaction is not null) { await transaction.RollbackAsync(ct); await transaction.DisposeAsync(); transaction = null; }
        db.ChangeTracker.Clear();
    }
    public async Task SaveAsync(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new ApiException(409, "Concurrent change; retry request"); }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: "23505" }) { throw new ApiException(409, "Resource already exists"); }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: "23503" }) { throw new ApiException(409, "Resource is referenced or missing"); }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: "40001" }) { throw new ApiException(409, "Concurrent change; retry request"); }
    }
}
