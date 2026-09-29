using ModularBackend.Domain;

namespace ModularBackend.Application;

public interface IBackendStore
{
    Task<User?> UserAsync(Guid id, CancellationToken ct);
    Task<User?> UserByEmailAsync(string email, CancellationToken ct);
    Task<Role?> RoleAsync(Guid id, CancellationToken ct);
    Task<Role?> RoleByNameAsync(string name, CancellationToken ct);
    Task<Permission?> PermissionAsync(Guid id, CancellationToken ct);
    Task<IReadOnlyList<Role>> RolesAsync(CancellationToken ct);
    Task<IReadOnlyList<Permission>> PermissionsAsync(CancellationToken ct);
    Task<(IReadOnlyList<User> Rows, int Total)> UsersAsync(UserQuery query, CancellationToken ct);
    Task<bool> HasPermissionAsync(Guid userId, string permission, CancellationToken ct);
    Task<bool> HasRoleUsersAsync(Guid roleId, CancellationToken ct);
    Task<StoredFile?> FileAsync(Guid id, CancellationToken ct);
    Task<bool> IsFileReferencedAsync(string objectKey, CancellationToken ct);
    Task<RefreshToken?> RefreshTokenAsync(string tokenHash, CancellationToken ct);
    Task RevokeRefreshFamilyAsync(Guid familyId, DateTimeOffset revokedAt, CancellationToken ct);
    void AddUser(User user);
    void AddRole(Role role);
    void AddPermission(Permission permission);
    void RemoveRole(Role role);
    void RemovePermission(Permission permission);
    void AddFile(StoredFile file);
    void AddAudit(ActivityLog log);
    void AddRefreshToken(RefreshToken token);
    Task BeginAsync(CancellationToken ct);
    Task CommitAsync(CancellationToken ct, bool invalidateCache = true);
    Task RollbackAsync(CancellationToken ct);
    Task SaveAsync(CancellationToken ct);
}
public interface IPasswordService
{
    string Hash(User user, string password);
    bool Verify(User user, string password);
}
public interface ITokenService { string Issue(User user); }
public interface IAuditFailureReporter { void Report(Exception exception, string endpointId); }
public sealed record StoredObject(string Storage, string Key);
public interface IObjectStorage
{
    Task<StoredObject> PutAsync(Stream stream, string mime, CancellationToken ct);
    Task RemoveAsync(StoredObject storedObject, CancellationToken ct);
}
public interface ICacheInvalidation { Task InvalidateAsync(CancellationToken ct); }
public interface INotificationStore
{
    Task<Notification> CreateAsync(Guid recipientId, string title, string body, bool sendEmail, OperationContext context, CancellationToken ct);
    Task<IReadOnlyList<Notification>> ListAsync(Guid recipientId, bool unreadOnly, CancellationToken ct);
    Task<Notification> MarkReadAsync(Guid id, OperationContext context, CancellationToken ct);
    Task<Notification> SetEmailStatusAsync(Guid id, string status, CancellationToken ct);
    Task<string?> RecipientEmailAsync(Guid id, CancellationToken ct);
}
public interface INotificationMailSender
{
    bool Enabled { get; }
    Task SendAsync(string recipient, string subject, string body, CancellationToken ct);
}
