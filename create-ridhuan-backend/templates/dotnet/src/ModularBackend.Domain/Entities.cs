namespace ModularBackend.Domain;

public abstract class Entity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public uint Version { get; set; }
}
public sealed class User : Entity
{
    public required string Email { get; set; }
    public required string PasswordHash { get; set; }
    public Guid RoleId { get; set; }
    public Role Role { get; set; } = null!;
    public DateTimeOffset? DeletedAt { get; set; }
}
public sealed class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string TokenHash { get; set; }
    public Guid FamilyId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset FamilyExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? ReplacedByTokenHash { get; set; }
}
public sealed class Role : Entity
{
    public required string Name { get; set; }
    public List<RolePermission> Permissions { get; set; } = [];
}
public sealed class Permission : Entity
{
    public required string Name { get; set; }
}
public sealed class RolePermission
{
    public Guid RoleId { get; set; }
    public Guid PermissionId { get; set; }
    public Role Role { get; set; } = null!;
    public Permission Permission { get; set; } = null!;
}
public sealed class ActivityLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public Guid? ActorIdSnapshot { get; set; }
    public string? ActorEmailSnapshot { get; set; }
    public required string Module { get; set; }
    public required string Behavior { get; set; }
    public Guid? EntityId { get; set; }
    public required string EndpointId { get; set; }
    public required string RequestId { get; set; }
    public string? Before { get; set; }
    public string? After { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class StoredFile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Storage { get; set; }
    public required string ObjectKey { get; set; }
    public required string OriginalName { get; set; }
    public required string MimeType { get; set; }
    public long Size { get; set; }
    public Guid? UploaderId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class Notification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RecipientId { get; set; }
    public Guid? ActorId { get; set; }
    public required string Title { get; set; }
    public required string Body { get; set; }
    public string EmailStatus { get; set; } = "NOT_REQUESTED";
    public DateTimeOffset? ReadAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
