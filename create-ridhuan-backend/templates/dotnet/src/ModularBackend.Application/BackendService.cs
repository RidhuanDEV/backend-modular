using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ModularBackend.Domain;

namespace ModularBackend.Application;

public sealed class BackendService(IBackendStore store, IPasswordService passwords, ITokenService tokens, TimeProvider clock, IAuditFailureReporter auditFailures, ICacheInvalidation invalidation)
{
    private static UserResult Map(User u) => new(u.Id, u.Email, u.RoleId, u.CreatedAt, u.UpdatedAt,
        new UserRole(u.Role.Id, u.Role.Name, u.Role.Permissions.Select(p => new PermissionSummary(p.Permission.Id, p.Permission.Name)).ToArray()));
    private static AuthUserResult AuthMap(User u) => new(u.Id, u.Email, u.RoleId);
    private static RoleResult Map(Role r, bool grants = true) => new(r.Id, r.Name, r.CreatedAt, r.UpdatedAt, grants ? r.Permissions.Select(p => new RoleGrant(new(p.Permission.Id, p.Permission.Name))).ToArray() : null);
    private static PermissionResult Map(Permission p) => new(p.Id, p.Name, p.CreatedAt, p.UpdatedAt);
    public static FileResult MapFile(StoredFile f) => new(f.Id, f.OriginalName, f.MimeType, f.Size, f.CreatedAt);
    private ActivityLog Audit(OperationContext ctx, string behavior, Guid? id, string? before, string? after) => new()
    {
        UserId = ctx.Actor?.Id,
        ActorIdSnapshot = ctx.Actor?.Id,
        ActorEmailSnapshot = ctx.Actor?.Email,
        Module = ctx.Module,
        EndpointId = ctx.EndpointId,
        RequestId = ctx.RequestId,
        Behavior = behavior,
        EntityId = id,
        Before = AuditRedactor.Redact(before),
        After = AuditRedactor.Redact(after),
        CreatedAt = clock.GetUtcNow()
    };
    private async Task<T> MutateAsync<T>(OperationContext ctx, string behavior, Func<CancellationToken, Task<(T Result, Guid Id, string? Before, string? After)>> mutation, CancellationToken ct)
    {
        await store.BeginAsync(ct);
        (T Result, Guid Id, string? Before, string? After) result;
        try
        {
            result = await mutation(ct);
            if (ctx.EndpointId == "auth.register" && result.Result is AuthUserResult registered) ctx = ctx with { Actor = new(registered.Id, registered.Email, registered.RoleId) };
            if (ctx.Audit == AuditMode.Required) store.AddAudit(Audit(ctx, behavior, result.Id, result.Before, result.After));
            await store.CommitAsync(ct);
        }
        catch { await store.RollbackAsync(CancellationToken.None); throw; }
        await invalidation.InvalidateAsync(CancellationToken.None);
        if (ctx.Audit == AuditMode.Optional) await OptionalAuditAsync(Audit(ctx, behavior, result.Id, result.Before, result.After));
        return result.Result;
    }
    private async Task OptionalAuditAsync(ActivityLog audit)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try { store.AddAudit(audit); await store.SaveAsync(timeout.Token); }
        catch (Exception ex) { auditFailures.Report(ex, audit.EndpointId); }
    }
    public async Task<AuthUserResult> RegisterAsync(string email, string password, OperationContext ctx, CancellationToken ct)
    {
        return await MutateAsync<AuthUserResult>(ctx, "REGISTER", async token =>
        {
            if (await store.UserByEmailAsync(email, token) is not null) throw new ApiException(409, "Email already registered");
            var role = await store.RoleByNameAsync("user", token) ?? throw new ApiException(500, "Default role not found. Please seed the database.");
            var user = NewUser(email, password, role);
            store.AddUser(user);
            var result = AuthMap(user);
            return (result, user.Id, null, JsonSerializer.Serialize(result));
        }, ct);
    }
    private User NewUser(string email, string password, Role role)
    {
        var user = new User { Email = email, PasswordHash = "", RoleId = role.Id, Role = role, CreatedAt = clock.GetUtcNow(), UpdatedAt = clock.GetUtcNow() };
        user.PasswordHash = passwords.Hash(user, password);
        return user;
    }
    // Unknown emails still pay one hash verification so response time does not reveal which accounts exist.
    private static string? timingHash;
    private void VerifyAgainstDummyHash(string password)
    {
        var dummy = new User { Email = "", PasswordHash = "" };
        dummy.PasswordHash = timingHash ??= passwords.Hash(dummy, Convert.ToHexString(RandomNumberGenerator.GetBytes(16)));
        passwords.Verify(dummy, password);
    }
    // The seeded root role is exempt: it must be able to hand out permissions created after seeding, which it does not hold itself.
    public const string RootRole = "admin";
    // Anti-escalation rule: an actor may only grant, assign or manage permissions it already holds.
    // Route policies (manage_users, manage_roles) decide who may call an endpoint; this decides what they may hand out.
    private async Task EnsureWithinActorAsync(OperationContext ctx, IEnumerable<Guid> permissionIds, CancellationToken ct)
    {
        var required = permissionIds.ToHashSet();
        if (required.Count == 0) return;
        var actorRole = ctx.Actor is null ? null : await store.RoleAsync(ctx.Actor.RoleId, ct);
        if (actorRole?.Name == RootRole) return;
        if (actorRole is null || !required.IsSubsetOf(actorRole.Permissions.Select(p => p.PermissionId))) throw new ApiException(403, "You cannot grant or manage permissions you do not hold");
    }
    private Task EnsureRoleWithinActorAsync(OperationContext ctx, Role role, CancellationToken ct) => EnsureWithinActorAsync(ctx, role.Permissions.Select(p => p.PermissionId).ToArray(), ct);
    private static string NewRefreshToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static string HashRefreshToken(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    private AuthTokensResult IssuePair(User user, string refreshToken) => new(tokens.Issue(user), refreshToken, "Bearer", 900);
    private (RefreshToken Entity, string Plaintext) CreateRefreshToken(Guid userId, Guid? familyId = null)
    {
        var now = clock.GetUtcNow(); var raw = NewRefreshToken(); var familyExpiry = now.AddDays(30);
        return (new RefreshToken { TokenHash = HashRefreshToken(raw), FamilyId = familyId ?? Guid.NewGuid(), UserId = userId, CreatedAt = now, ExpiresAt = familyExpiry, FamilyExpiresAt = familyExpiry }, raw);
    }
    public async Task<AuthTokensResult> LoginAsync(string email, string password, OperationContext ctx, CancellationToken ct)
    {
        var user = await store.UserByEmailAsync(email, ct);
        if (user is null) VerifyAgainstDummyHash(password);
        if (user is null || user.DeletedAt is not null || !passwords.Verify(user, password)) throw new ApiException(401, "Invalid email or password");
        var (refresh, plaintext) = CreateRefreshToken(user.Id);
        await store.BeginAsync(ct);
        try { store.AddRefreshFamily(new RefreshFamily { Id = refresh.FamilyId, UserId = user.Id, CreatedAt = refresh.CreatedAt, ExpiresAt = refresh.ExpiresAt }); store.AddRefreshToken(refresh); if (ctx.Audit == AuditMode.Required) store.AddAudit(Audit(ctx with { Actor = new(user.Id, user.Email, user.RoleId) }, "LOGIN", user.Id, null, JsonSerializer.Serialize(new PermissionSummary(user.Id, user.Email)))); await store.CommitAsync(ct, invalidateCache: false); }
        catch { await store.RollbackAsync(CancellationToken.None); throw; }
        if (ctx.Audit == AuditMode.Optional) await OptionalAuditAsync(Audit(ctx with { Actor = new(user.Id, user.Email, user.RoleId) }, "LOGIN", user.Id, null, null));
        return IssuePair(user, plaintext);
    }
    public async Task<AuthTokensResult> RefreshAsync(string suppliedToken, OperationContext ctx, CancellationToken ct)
    {
        var lookup = await store.RefreshTokenAsync(HashRefreshToken(suppliedToken), ct);
        if (lookup is null) throw new ApiException(401, "Invalid refresh token");
        User? user = null; string? plaintext = null; ActivityLog? entry = null;
        await store.BeginSessionAsync(ct);
        try
        {
            var family = await store.LockRefreshFamilyAsync(lookup.FamilyId, ct);
            var current = await store.LockRefreshTokenAsync(lookup.Id, ct);
            var now = clock.GetUtcNow();
            if (family is null || current is null) throw new ApiException(401, "Invalid refresh token");
            var before = JsonSerializer.Serialize(new { family.ExpiresAt, Revoked = family.RevokedAt is not null });
            user = await store.UserAsync(current.UserId, ct);
            ctx = ctx with { Actor = user is null ? null : new(user.Id, user.Email, user.RoleId) };
            if (family.RevokedAt is not null || family.ExpiresAt <= now || current.RevokedAt is not null || current.ExpiresAt <= now || user is null || user.DeletedAt is not null)
            {
                family.RevokedAt ??= now;
                await store.RevokeRefreshFamilyAsync(family.Id, now, ct);
                entry = Audit(ctx, "REFRESH_REPLAY", family.Id, before, JsonSerializer.Serialize(new { family.ExpiresAt, Revoked = true }));
                user = null;
            }
            else
            {
                var (replacement, raw) = CreateRefreshToken(user.Id, family.Id);
                plaintext = raw; family.ExpiresAt = replacement.ExpiresAt;
                current.RevokedAt = now; current.ReplacedByTokenHash = replacement.TokenHash;
                store.AddRefreshToken(replacement);
                entry = Audit(ctx, "TOKEN_REFRESH", family.Id, before, JsonSerializer.Serialize(new { family.ExpiresAt, Revoked = false }));
            }
            if (ctx.Audit == AuditMode.Required) store.AddAudit(entry);
            await store.CommitAsync(ct, invalidateCache: false);
        }
        catch { await store.RollbackAsync(CancellationToken.None); throw; }
        if (ctx.Audit == AuditMode.Optional && entry is not null) await OptionalAuditAsync(entry);
        if (user is null || plaintext is null) throw new ApiException(401, "Invalid or expired refresh token");
        return IssuePair(user, plaintext);
    }
    public async Task LogoutAsync(string suppliedToken, OperationContext ctx, CancellationToken ct)
    {
        var lookup = await store.RefreshTokenAsync(HashRefreshToken(suppliedToken), ct);
        if (lookup is null) return;
        ActivityLog? entry = null;
        await store.BeginSessionAsync(ct);
        try
        {
            var family = await store.LockRefreshFamilyAsync(lookup.FamilyId, ct);
            if (family is not null && family.RevokedAt is null)
            {
                var before = JsonSerializer.Serialize(new { family.ExpiresAt, Revoked = false });
                var user = await store.UserAsync(family.UserId, ct);
                ctx = ctx with { Actor = user is null ? null : new(user.Id, user.Email, user.RoleId) };
                family.RevokedAt = clock.GetUtcNow();
                await store.RevokeRefreshFamilyAsync(family.Id, family.RevokedAt.Value, ct);
                entry = Audit(ctx, "LOGOUT", family.Id, before, JsonSerializer.Serialize(new { family.ExpiresAt, Revoked = true }));
                if (ctx.Audit == AuditMode.Required) store.AddAudit(entry);
            }
            await store.CommitAsync(ct, invalidateCache: false);
        }
        catch { await store.RollbackAsync(CancellationToken.None); throw; }
        if (ctx.Audit == AuditMode.Optional && entry is not null) await OptionalAuditAsync(entry);
    }
    public async Task<AuthUserResult> MeAsync(Guid id, CancellationToken ct) => AuthMap(await store.UserAsync(id, ct) ?? throw new ApiException(404, "User not found"));
    public async Task<UserResult> UserAsync(Guid id, CancellationToken ct) => Map(await store.UserAsync(id, ct) ?? throw new ApiException(404, "User not found"));
    public async Task<PageResult> UsersAsync(UserQuery query, CancellationToken ct)
    {
        if (query.Page < 1 || query.Limit is < 1 or > 100 || query.Page > int.MaxValue / Math.Max(1, query.Limit)) throw new ApiException(400, "Invalid pagination");
        if (query.OrderBy is not (null or "asc" or "desc")) throw new ApiException(400, "Invalid orderBy");
        var (rows, total) = await store.UsersAsync(query, ct);
        var pages = (int)Math.Ceiling((double)total / query.Limit);
        var fields = (query.Fields ?? "").Split(',').Select(f => f.Trim()).Where(f => f is "id" or "email" or "roleId").ToHashSet(StringComparer.Ordinal);
        var projected = rows.Select(u => fields.Count == 0
            ? new UserProjection(u.Id, u.Email, u.RoleId, u.CreatedAt, u.UpdatedAt, Map(u).Role)
            : new UserProjection(fields.Contains("id") ? u.Id : null, fields.Contains("email") ? u.Email : null, fields.Contains("roleId") ? u.RoleId : null)).ToArray();
        return new(projected, new(query.Page, query.Limit, total, pages, query.Page < pages, query.Page > 1));
    }
    public Task<UserResult> CreateUserAsync(string email, string password, Guid roleId, OperationContext ctx, CancellationToken ct) => MutateAsync<UserResult>(ctx, "CREATE", async token =>
    {
        var role = await store.RoleAsync(roleId, token) ?? throw new ApiException(400, "Role not found");
        await EnsureRoleWithinActorAsync(ctx, role, token);
        var user = NewUser(email, password, role); store.AddUser(user); var result = Map(user);
        return (result, user.Id, null, JsonSerializer.Serialize(result));
    }, ct);
    public Task<UserResult> UpdateUserAsync(Guid id, string? email, Guid? roleId, OperationContext ctx, CancellationToken ct) => MutateAsync(ctx, "UPDATE", async token =>
    {
        var user = await store.UserAsync(id, token) ?? throw new ApiException(404, "User not found");
        await EnsureRoleWithinActorAsync(ctx, user.Role, token);
        var before = JsonSerializer.Serialize(Map(user));
        if (email is not null) user.Email = email;
        if (roleId is not null)
        {
            var nextRole = await store.RoleAsync(roleId.Value, token) ?? throw new ApiException(400, "Role not found");
            await EnsureRoleWithinActorAsync(ctx, nextRole, token);
            user.Role = nextRole; user.RoleId = roleId.Value;
        }
        user.UpdatedAt = clock.GetUtcNow(); var result = Map(user); return (result, id, before, JsonSerializer.Serialize(result));
    }, ct);
    public async Task DeleteUserAsync(Guid id, OperationContext ctx, CancellationToken ct)
    {
        await MutateAsync(ctx, "DELETE", async token =>
        {
            if (ctx.Actor?.Id == id) throw new ApiException(403, "You cannot delete your own account.");
            var user = await store.UserAsync(id, token) ?? throw new ApiException(404, "User not found");
            await EnsureRoleWithinActorAsync(ctx, user.Role, token);
            var before = JsonSerializer.Serialize(Map(user)); user.DeletedAt = clock.GetUtcNow(); user.UpdatedAt = clock.GetUtcNow(); return (true, id, before, (string?)null);
        }, ct);
    }
    public async Task<IReadOnlyList<RoleResult>> RolesAsync(CancellationToken ct) => (await store.RolesAsync(ct)).Select(r => Map(r)).ToArray();
    public async Task<RoleResult> RoleAsync(Guid id, CancellationToken ct) => Map(await store.RoleAsync(id, ct) ?? throw new ApiException(404, "Role not found"));
    public Task<RoleResult> CreateRoleAsync(string name, OperationContext ctx, CancellationToken ct) => MutateAsync(ctx, "CREATE", token =>
    {
        token.ThrowIfCancellationRequested(); var role = new Role { Name = name, CreatedAt = clock.GetUtcNow(), UpdatedAt = clock.GetUtcNow() }; store.AddRole(role); var result = Map(role, false);
        return Task.FromResult((result, role.Id, (string?)null, (string?)JsonSerializer.Serialize(result)));
    }, ct);
    public Task<RoleResult> UpdateRoleAsync(Guid id, string? name, OperationContext ctx, CancellationToken ct) => MutateAsync(ctx, "UPDATE", async token =>
    {
        var role = await store.RoleAsync(id, token) ?? throw new ApiException(404, "Role not found"); var before = JsonSerializer.Serialize(Map(role));
        await EnsureRoleWithinActorAsync(ctx, role, token);
        if (name is not null) role.Name = name; role.UpdatedAt = clock.GetUtcNow(); var result = Map(role, false); return (result, id, before, JsonSerializer.Serialize(result));
    }, ct);
    public async Task DeleteRoleAsync(Guid id, OperationContext ctx, CancellationToken ct) => await MutateAsync(ctx, "DELETE", async token =>
    {
        var role = await store.RoleAsync(id, token) ?? throw new ApiException(404, "Role not found");
        await EnsureRoleWithinActorAsync(ctx, role, token);
        if (await store.HasRoleUsersAsync(id, token)) throw new ApiException(409, "Role is assigned to users");
        var before = JsonSerializer.Serialize(Map(role)); store.RemoveRole(role); return (true, id, before, (string?)null);
    }, ct);
    public Task<RoleResult> AssignPermissionsAsync(Guid id, IReadOnlyList<Guid> ids, OperationContext ctx, CancellationToken ct) => MutateAsync(ctx, "ASSIGN_PERMISSIONS", async token =>
    {
        var role = await store.RoleAsync(id, token) ?? throw new ApiException(404, "Role not found"); var before = JsonSerializer.Serialize(Map(role));
        // Both the permissions being removed and the ones being granted must be within the actor's own.
        await EnsureRoleWithinActorAsync(ctx, role, token);
        await EnsureWithinActorAsync(ctx, ids, token);
        var permissions = new List<Permission>(); foreach (var permissionId in ids.Distinct()) permissions.Add(await store.PermissionAsync(permissionId, token) ?? throw new ApiException(400, "Permission not found"));
        role.Permissions.RemoveAll(p => !ids.Contains(p.PermissionId));
        foreach (var p in permissions.Where(p => role.Permissions.All(g => g.PermissionId != p.Id))) role.Permissions.Add(new RolePermission { RoleId = id, PermissionId = p.Id, Permission = p, Role = role });
        role.UpdatedAt = clock.GetUtcNow(); var result = Map(role); return (result, id, before, JsonSerializer.Serialize(result));
    }, ct);
    public async Task<IReadOnlyList<PermissionResult>> PermissionsAsync(CancellationToken ct) => (await store.PermissionsAsync(ct)).Select(Map).ToArray();
    public async Task<PermissionResult> PermissionAsync(Guid id, CancellationToken ct) => Map(await store.PermissionAsync(id, ct) ?? throw new ApiException(404, "Permission not found"));
    public Task<PermissionResult> CreatePermissionAsync(string name, OperationContext ctx, CancellationToken ct) => MutateAsync(ctx, "CREATE", token =>
    {
        token.ThrowIfCancellationRequested(); var p = new Permission { Name = name, CreatedAt = clock.GetUtcNow(), UpdatedAt = clock.GetUtcNow() }; store.AddPermission(p); var result = Map(p); return Task.FromResult((result, p.Id, (string?)null, (string?)JsonSerializer.Serialize(result)));
    }, ct);
    public Task<PermissionResult> UpdatePermissionAsync(Guid id, string? name, OperationContext ctx, CancellationToken ct) => MutateAsync(ctx, "UPDATE", async token =>
    {
        var p = await store.PermissionAsync(id, token) ?? throw new ApiException(404, "Permission not found"); var before = JsonSerializer.Serialize(Map(p)); if (name is not null) p.Name = name; p.UpdatedAt = clock.GetUtcNow(); var result = Map(p); return (result, id, before, JsonSerializer.Serialize(result));
    }, ct);
    public async Task DeletePermissionAsync(Guid id, OperationContext ctx, CancellationToken ct) => await MutateAsync(ctx, "DELETE", async token =>
    {
        var p = await store.PermissionAsync(id, token) ?? throw new ApiException(404, "Permission not found"); var before = JsonSerializer.Serialize(Map(p)); store.RemovePermission(p); return (true, id, before, (string?)null);
    }, ct);
    public Task<bool> IsFileReferencedAsync(string objectKey, CancellationToken ct) => store.IsFileReferencedAsync(objectKey, ct);
    public async Task<FileResult> FileAsync(Guid id, CancellationToken ct) => MapFile(await store.FileAsync(id, ct) ?? throw new ApiException(404, "File not found"));
    public Task<FileResult> SaveFileAsync(StoredFile file, OperationContext ctx, CancellationToken ct) => MutateAsync(ctx, "CREATE", token =>
    {
        token.ThrowIfCancellationRequested(); store.AddFile(file); var result = MapFile(file); return Task.FromResult((result, file.Id, (string?)null, (string?)JsonSerializer.Serialize(result)));
    }, ct);
    public async Task ReadAuditAsync(OperationContext ctx, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested(); if (ctx.Audit == AuditMode.Optional) await OptionalAuditAsync(Audit(ctx, "READ", null, null, null));
    }
}
