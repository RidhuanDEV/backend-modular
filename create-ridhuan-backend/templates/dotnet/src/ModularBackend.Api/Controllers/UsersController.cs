using Microsoft.AspNetCore.Mvc;
using ModularBackend.Api.Authorization;
using ModularBackend.Api.Contracts;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Caching;

namespace ModularBackend.Api.Controllers;

[ApiController, Route("api/users")]
public sealed class UsersController(
    BackendService service,
    EndpointRegistry registry,
    ResponseCache cache
) : ControllerBase
{
    private OperationContext Context =>
        EndpointFilter.Context(HttpContext, registry.Get(HttpContext));
    private bool Cached => registry.Get(HttpContext).Cache == CacheMode.Read;

    [
        HttpGet,
        Endpoint(EndpointId.UserList),
        ProducesResponseType<Success<IReadOnlyList<UserProjection>>>(200)
    ]
    public async Task<ActionResult<Success<IReadOnlyList<UserProjection>>>> List(
        [FromQuery] UserQuery query,
        CancellationToken ct
    )
    {
        var key =
            "users:"
            + Context.Actor?.Id
            + ":"
            + Convert.ToHexString(
                System.Security.Cryptography.SHA256.HashData(
                    System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(query)
                )
            );
        var result = await cache.ReadAsync(
            key,
            Cached,
            token => service.UsersAsync(query, token),
            p =>
                p.Meta is not null
                && p.Meta.Limit > 0
                && p.Data is not null
                && p.Data.All(u =>
                    (u.Id is not null || u.Email is not null || u.RoleId is not null)
                    && u.Id != Guid.Empty
                    && (u.Email is null || u.Email.Length > 0)
                ),
            ct
        );
        return Ok(new Success<IReadOnlyList<UserProjection>>(result.Data, result.Meta));
    }

    [HttpGet("{id}"), Endpoint(EndpointId.UserGet), ProducesResponseType<Success<UserResult>>(200)]
    public async Task<ActionResult<Success<UserResult>>> Get(Guid id, CancellationToken ct) =>
        Ok(
            new Success<UserResult>(
                await cache.ReadAsync(
                    "user:" + Context.Actor?.Id + ":" + id,
                    Cached,
                    token => service.UserAsync(id, token),
                    u => u.Id == id && !string.IsNullOrEmpty(u.Email),
                    ct
                )
            )
        );

    [HttpPost, Endpoint(EndpointId.UserCreate), ProducesResponseType<Success<UserResult>>(201)]
    public async Task<ActionResult<Success<UserResult>>> Create(
        CreateUserRequest input,
        CancellationToken ct
    ) =>
        StatusCode(
            201,
            new Success<UserResult>(
                await service.CreateUserAsync(
                    input.Email,
                    input.Password,
                    input.RoleId,
                    Context,
                    ct
                )
            )
        );

    [
        HttpPatch("{id}"),
        Endpoint(EndpointId.UserUpdate),
        ProducesResponseType<Success<UserResult>>(200)
    ]
    public async Task<ActionResult<Success<UserResult>>> Update(
        Guid id,
        UpdateUserRequest input,
        CancellationToken ct
    ) =>
        Ok(
            new Success<UserResult>(
                await service.UpdateUserAsync(id, input.Email, input.RoleId, Context, ct)
            )
        );

    [HttpDelete("{id}"), Endpoint(EndpointId.UserDelete), ProducesResponseType(204)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await service.DeleteUserAsync(id, Context, ct);
        return NoContent();
    }
}
