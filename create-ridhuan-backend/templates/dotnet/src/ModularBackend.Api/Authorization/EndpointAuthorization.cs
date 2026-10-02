using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;

namespace ModularBackend.Api.Authorization;

public sealed record PermissionRequirement(string Permission) : IAuthorizationRequirement;
public sealed class PermissionHandler(IBackendStore store, IHttpContextAccessor accessor) : AuthorizationHandler<PermissionRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        if (Guid.TryParse(context.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) && await store.HasPermissionAsync(id, requirement.Permission, accessor.HttpContext?.RequestAborted ?? CancellationToken.None)) context.Succeed(requirement);
    }
}
public sealed class EndpointFilter(EndpointRegistry registry, IAuthorizationService authorization, BackendService service, ILogger<EndpointFilter> logger) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var policy = registry.Get(context.HttpContext);
        System.Diagnostics.Activity.Current?.SetTag("operationId", policy.WireId);
        using var scope = logger.BeginScope(new Dictionary<string, string> { ["EndpointId"] = policy.WireId, ["ActorId"] = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous" });
        if (!policy.Public)
        {
            if (context.HttpContext.User.Identity?.IsAuthenticated != true) { context.Result = new ObjectResult(new Failure("Unauthorized", [])) { StatusCode = 401 }; return; }
            if (policy.Permission.Length > 0 && !(await authorization.AuthorizeAsync(context.HttpContext.User, null, policy.Permission)).Succeeded) { context.Result = new ObjectResult(new Failure("Forbidden", [])) { StatusCode = 403 }; return; }
        }
        var result = await next();
        if (result.Exception is null && policy.Method == "GET") await service.ReadAuditAsync(Context(context.HttpContext, policy), context.HttpContext.RequestAborted);
    }
    public static OperationContext Context(HttpContext http, EndpointPolicy policy)
    {
        Actor? actor = null;
        if (Guid.TryParse(http.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) && Guid.TryParse(http.User.FindFirstValue("roleId"), out var roleId)) actor = new(id, http.User.FindFirstValue(ClaimTypes.Email) ?? "", roleId);
        return new(policy.WireId, policy.Module, policy.Audit, actor, http.TraceIdentifier);
    }
}
