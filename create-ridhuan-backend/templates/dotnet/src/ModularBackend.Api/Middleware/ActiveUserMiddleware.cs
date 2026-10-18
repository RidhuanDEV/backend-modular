using System.Security.Claims;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;

namespace ModularBackend.Api.Middleware;

/// <summary>
/// The JWT only proves identity. This loads the live user after rate limiting, so a
/// throttled request never reaches the database, and a deleted user or role change
/// takes effect immediately instead of when the token expires.
/// </summary>
public sealed class ActiveUserMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext http, IBackendStore store)
    {
        if (
            http.User.Identity?.IsAuthenticated != true
            || http.GetEndpoint()?.Metadata.GetMetadata<EndpointAttribute>() is null
        )
        {
            await next(http);
            return;
        }
        var user = Guid.TryParse(http.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
            ? await store.UserAsync(id, http.RequestAborted)
            : null;
        if (user is null)
        {
            http.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await http.Response.WriteAsJsonAsync(
                new Failure("Unauthorized", []),
                http.RequestAborted
            );
            return;
        }
        if (http.User.Identity is ClaimsIdentity identity)
        {
            foreach (var claim in identity.FindAll("roleId").ToArray())
                identity.RemoveClaim(claim);
            identity.AddClaim(new Claim("roleId", user.RoleId.ToString()));
            foreach (var claim in identity.FindAll(ClaimTypes.Email).ToArray())
                identity.RemoveClaim(claim);
            identity.AddClaim(new Claim(ClaimTypes.Email, user.Email));
        }
        await next(http);
    }
}
