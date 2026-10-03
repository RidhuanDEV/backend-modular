using System.Text.Json.Serialization;

namespace ModularBackend.Application;

public sealed record Success<T>(T Data, Pagination? Meta = null)
{
    [JsonPropertyName("success")]
    public bool IsSuccess => true;
}

public sealed record Failure(string Message, IReadOnlyList<string> Errors)
{
    [JsonPropertyName("success")]
    public bool IsSuccess => false;
}

public sealed record Pagination(
    int Page,
    int Limit,
    int TotalItems,
    int TotalPages,
    bool HasNextPage,
    bool HasPrevPage
);

public sealed record StatusResult(string Status);

public sealed record AuthTokensResult(
    string AccessToken,
    string RefreshToken,
    string TokenType,
    int ExpiresIn
);

public sealed record RefreshRequest(string RefreshToken);

public sealed record PermissionSummary(Guid Id, string Name);

public sealed record PermissionResult(
    Guid Id,
    string Name,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt
);

public sealed record RoleGrant(PermissionSummary Permission);

public sealed record RoleResult(
    Guid Id,
    string Name,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<RoleGrant>? Permissions = null
);

public sealed record UserRole(Guid Id, string Name, IReadOnlyList<PermissionSummary> Permissions);

public sealed record UserResult(
    Guid Id,
    string Email,
    Guid RoleId,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    UserRole? Role = null
);

public sealed record UserProjection(
    Guid? Id = null,
    string? Email = null,
    Guid? RoleId = null,
    DateTimeOffset? CreatedAt = null,
    DateTimeOffset? UpdatedAt = null,
    UserRole? Role = null
);

public sealed record AuthUserResult(Guid Id, string Email, Guid RoleId);

public sealed record FileResult(
    Guid Id,
    string OriginalName,
    string MimeType,
    long Size,
    DateTimeOffset CreatedAt
);

public sealed record NotificationResult(
    Guid Id,
    Guid RecipientId,
    string Title,
    string Body,
    string EmailStatus,
    DateTimeOffset? ReadAt,
    DateTimeOffset CreatedAt
);

public sealed record UserQuery(
    int Page = 1,
    int Limit = 10,
    string? SortBy = null,
    string? OrderBy = null,
    string? Search = null,
    string? Fields = null
);

public sealed record PageResult(IReadOnlyList<UserProjection> Data, Pagination Meta);

public sealed record Actor(Guid Id, string Email, Guid RoleId);

public enum AuditMode
{
    Required,
    Optional,
    None,
}

public enum CacheMode
{
    Read,
    Off,
}

public enum RateLimitGroup
{
    Auth,
    Public,
    Internal,
}

public sealed record OperationContext(
    string EndpointId,
    string Module,
    AuditMode Audit,
    Actor? Actor,
    string RequestId
);

public sealed class ApiException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
