using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace ModularBackend.Api.Contracts;

public sealed record RegisterRequest([Required, EmailAddress] string Email, [Required, MinLength(6)] string Password);
public sealed record LoginRequest([Required, EmailAddress] string Email, [Required, MinLength(1)] string Password);
public sealed record RefreshTokenRequest([Required, MinLength(32), MaxLength(128)] string RefreshToken);
public sealed record CreateUserRequest([Required, EmailAddress] string Email, [Required, MinLength(6)] string Password, [Required, NonEmptyGuid] Guid RoleId);
public sealed record UpdateUserRequest([property: JsonConverter(typeof(NonNullStringConverter))][EmailAddress] string? Email = null, [property: JsonConverter(typeof(NonNullGuidConverter))][NonEmptyGuid] Guid? RoleId = null);
public sealed record CreateRoleRequest([Required, StringLength(64, MinimumLength = 1)] string Name);
public sealed record UpdateRoleRequest([property: JsonConverter(typeof(NonNullStringConverter))][StringLength(64, MinimumLength = 1)] string? Name = null);
public sealed record CreatePermissionRequest([Required, StringLength(128, MinimumLength = 1)] string Name);
public sealed record UpdatePermissionRequest([property: JsonConverter(typeof(NonNullStringConverter))][StringLength(128, MinimumLength = 1)] string? Name = null);
public sealed record AssignPermissionsRequest([Required, MinLength(1)] Guid[] PermissionIds);
public sealed record CreateNotificationRequest([Required, NonEmptyGuid] Guid RecipientId,
    [Required, StringLength(160, MinimumLength = 1)] string Title,
    [Required, StringLength(4000, MinimumLength = 1)] string Body, bool SendEmail = false);
public sealed class NonEmptyGuidAttribute : ValidationAttribute
{
    public override bool IsValid(object? value) => value is null || value is Guid id && id != Guid.Empty;
}
