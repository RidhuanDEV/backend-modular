using System.Collections.Frozen;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using ModularBackend.Application;
namespace ModularBackend.Api.Endpoints;

public enum EndpointId { HealthGet, LiveGet, ReadyGet, DocsSpec, DocsModuleSpec, DocsUi, AuthRegister, AuthLogin, AuthRefresh, AuthLogout, AuthMe, UserList, UserGet, UserCreate, UserUpdate, UserDelete, RoleList, RoleGet, RoleCreate, RoleUpdate, RoleDelete, RoleAssignPermissions, PermissionList, PermissionGet, PermissionCreate, PermissionUpdate, PermissionDelete, UploadCreate, UploadGet, NotificationCreate, NotificationList, NotificationRead, NotificationStream }
[AttributeUsage(AttributeTargets.Method)]
public sealed class EndpointAttribute(EndpointId id) : Attribute { public EndpointId Id { get; } = id; }
public enum AuditCapability { None, Read, Transaction }
public sealed record EndpointPolicy(EndpointId Id, string WireId, string Method, string Path, string Module, bool Public, string Permission, AuditMode Audit, RateLimitGroup RateLimit, CacheMode Cache, int Status) { public AuditCapability AuditCapability { get; init; } = Method == "GET" ? AuditCapability.Read : AuditCapability.Transaction; }
public sealed record PolicyOverride(AuditMode? Audit, RateLimitGroup? RateLimit, CacheMode? Cache);
public sealed class EndpointRegistry
{
    private static readonly EndpointPolicy[] Defaults = [
   new(EndpointId.HealthGet, "health.get", "GET", "/health", "system", true, "", AuditMode.None, RateLimitGroup.Public, CacheMode.Off, 200),
new(EndpointId.LiveGet, "live.get", "GET", "/live", "system", true, "", AuditMode.None, RateLimitGroup.Public, CacheMode.Off, 200),
new(EndpointId.ReadyGet, "ready.get", "GET", "/ready", "system", true, "", AuditMode.None, RateLimitGroup.Public, CacheMode.Off, 200),
new(EndpointId.DocsSpec, "docs.spec", "GET", "/docs/openapi.json", "docs", true, "", AuditMode.None, RateLimitGroup.Public, CacheMode.Off, 200),
new(EndpointId.DocsModuleSpec, "docs.moduleSpec", "GET", "/docs/specs/{module}.json", "docs", true, "", AuditMode.None, RateLimitGroup.Public, CacheMode.Off, 200),
new(EndpointId.DocsUi, "docs.ui", "GET", "/docs", "docs", true, "", AuditMode.None, RateLimitGroup.Public, CacheMode.Off, 200),
new(EndpointId.AuthRegister, "auth.register", "POST", "/api/auth/register", "auth", true, "", AuditMode.Required, RateLimitGroup.Auth, CacheMode.Off, 201),
new(EndpointId.AuthLogin, "auth.login", "POST", "/api/auth/login", "auth", true, "", AuditMode.Optional, RateLimitGroup.Auth, CacheMode.Off, 200),
new(EndpointId.AuthRefresh, "auth.refresh", "POST", "/api/auth/refresh", "auth", true, "", AuditMode.Optional, RateLimitGroup.Auth, CacheMode.Off, 200),
new(EndpointId.AuthLogout, "auth.logout", "POST", "/api/auth/logout", "auth", true, "", AuditMode.Optional, RateLimitGroup.Auth, CacheMode.Off, 204),
new(EndpointId.AuthMe, "auth.me", "GET", "/api/auth/me", "auth", false, "", AuditMode.None, RateLimitGroup.Internal, CacheMode.Off, 200),
new(EndpointId.UserList, "user.list", "GET", "/api/users", "user", false, "manage_users", AuditMode.None, RateLimitGroup.Internal, CacheMode.Read, 200),
new(EndpointId.UserGet, "user.get", "GET", "/api/users/{id}", "user", false, "manage_users", AuditMode.None, RateLimitGroup.Internal, CacheMode.Read, 200),
new(EndpointId.UserCreate, "user.create", "POST", "/api/users", "user", false, "manage_users", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 201),
new(EndpointId.UserUpdate, "user.update", "PATCH", "/api/users/{id}", "user", false, "manage_users", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 200),
new(EndpointId.UserDelete, "user.delete", "DELETE", "/api/users/{id}", "user", false, "manage_users", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 204),
new(EndpointId.RoleList, "role.list", "GET", "/api/roles", "roles", false, "manage_roles", AuditMode.None, RateLimitGroup.Internal, CacheMode.Read, 200),
new(EndpointId.RoleGet, "role.get", "GET", "/api/roles/{id}", "roles", false, "manage_roles", AuditMode.None, RateLimitGroup.Internal, CacheMode.Read, 200),
new(EndpointId.RoleCreate, "role.create", "POST", "/api/roles", "roles", false, "manage_roles", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 201),
new(EndpointId.RoleUpdate, "role.update", "PATCH", "/api/roles/{id}", "roles", false, "manage_roles", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 200),
new(EndpointId.RoleDelete, "role.delete", "DELETE", "/api/roles/{id}", "roles", false, "manage_roles", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 204),
new(EndpointId.RoleAssignPermissions, "role.assignPermissions", "POST", "/api/roles/{id}/permissions", "roles", false, "manage_roles", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 200),
new(EndpointId.PermissionList, "permission.list", "GET", "/api/permissions", "permissions", false, "manage_permissions", AuditMode.None, RateLimitGroup.Internal, CacheMode.Read, 200),
new(EndpointId.PermissionGet, "permission.get", "GET", "/api/permissions/{id}", "permissions", false, "manage_permissions", AuditMode.None, RateLimitGroup.Internal, CacheMode.Read, 200),
new(EndpointId.PermissionCreate, "permission.create", "POST", "/api/permissions", "permissions", false, "manage_permissions", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 201),
new(EndpointId.PermissionUpdate, "permission.update", "PATCH", "/api/permissions/{id}", "permissions", false, "manage_permissions", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 200),
new(EndpointId.PermissionDelete, "permission.delete", "DELETE", "/api/permissions/{id}", "permissions", false, "manage_permissions", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 204),
new(EndpointId.UploadCreate, "upload.create", "POST", "/api/upload", "upload", false, "manage_uploads", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 201),
new(EndpointId.UploadGet, "upload.get", "GET", "/api/upload/{id}", "upload", false, "manage_uploads", AuditMode.None, RateLimitGroup.Internal, CacheMode.Read, 200),
new(EndpointId.NotificationCreate, "notification.create", "POST", "/api/notifications", "notifications", false, "manage_notifications", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 201),
new(EndpointId.NotificationList, "notification.list", "GET", "/api/notifications", "notifications", false, "", AuditMode.None, RateLimitGroup.Internal, CacheMode.Off, 200),
new(EndpointId.NotificationRead, "notification.read", "PATCH", "/api/notifications/{id}/read", "notifications", false, "", AuditMode.Required, RateLimitGroup.Internal, CacheMode.Off, 200),
new(EndpointId.NotificationStream, "notification.stream", "GET", "/api/notifications/stream", "notifications", false, "", AuditMode.None, RateLimitGroup.Internal, CacheMode.Off, 200),
 ];
    public FrozenDictionary<EndpointId, EndpointPolicy> Policies { get; }
    public EndpointRegistry(IConfiguration configuration)
    {
        var definitions = Defaults.ToDictionary(p => p.Id);
        var raw = configuration["ENDPOINT_POLICIES_JSON"];
        if (!string.IsNullOrWhiteSpace(raw))
        {
            var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
            options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, false));
            var overrides = JsonSerializer.Deserialize<Dictionary<string, PolicyOverride>>(raw, options) ?? throw new InvalidOperationException("Invalid policy configuration");
            foreach (var (wireId, policy) in overrides)
            {
                var original = Defaults.SingleOrDefault(p => p.WireId == wireId) ?? throw new InvalidOperationException("Unknown endpoint policy");
                var updated = original with { Audit = policy.Audit ?? original.Audit, RateLimit = policy.RateLimit ?? original.RateLimit, Cache = policy.Cache ?? original.Cache };
                if (updated.AuditCapability != AuditCapability.Transaction && updated.Audit == AuditMode.Required) throw new InvalidOperationException("Required GET audit unsupported");
                if (updated.Cache == CacheMode.Read && (updated.Method != "GET" || updated.Module is "auth" or "system" or "docs")) throw new InvalidOperationException("Unsafe cache policy");
                definitions[original.Id] = updated;
            }
        }
        Policies = definitions.ToFrozenDictionary();
    }
    public EndpointPolicy Get(HttpContext context)
    {
        var metadata = context.GetEndpoint()?.Metadata.GetMetadata<EndpointAttribute>() ?? throw new InvalidOperationException("Missing endpoint ID");
        return Policies[metadata.Id];
    }
    public void Validate(IActionDescriptorCollectionProvider actions)
    {
        var controllers = actions.ActionDescriptors.Items.OfType<ControllerActionDescriptor>().ToArray();
        var mounted = new HashSet<EndpointId>();
        foreach (var action in controllers)
        {
            var attr = action.MethodInfo.GetCustomAttributes(typeof(EndpointAttribute), true).Cast<EndpointAttribute>().SingleOrDefault() ?? throw new InvalidOperationException("Action without endpoint ID");
            if (!mounted.Add(attr.Id)) throw new InvalidOperationException("Duplicate endpoint ID");
            var policy = Policies[attr.Id];
            var methods = action.ActionConstraints?.OfType<Microsoft.AspNetCore.Mvc.ActionConstraints.HttpMethodActionConstraint>().SelectMany(c => c.HttpMethods).ToArray() ?? [];
            if (!methods.Contains(policy.Method) || "/" + action.AttributeRouteInfo?.Template != policy.Path) throw new InvalidOperationException("Endpoint route differs from registry");
            if (policy.Permission is not ("" or "manage_users" or "manage_roles" or "manage_permissions" or "manage_uploads" or "manage_notifications")) throw new InvalidOperationException("Unknown permission");
        }
        if (mounted.Count != Policies.Count || Policies.Values.Select(p => p.Method + p.Path).Distinct().Count() != Policies.Count) throw new InvalidOperationException("Registry incomplete or colliding");
    }
}
