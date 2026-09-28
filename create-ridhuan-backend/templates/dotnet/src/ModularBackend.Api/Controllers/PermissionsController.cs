using Microsoft.AspNetCore.Mvc;
using ModularBackend.Api.Authorization;
using ModularBackend.Api.Contracts;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Caching;
namespace ModularBackend.Api.Controllers;

[ApiController, Route("api/permissions")]
public sealed class PermissionsController(BackendService service, EndpointRegistry registry, ResponseCache cache) : ControllerBase
{
    private OperationContext Context => EndpointFilter.Context(HttpContext, registry.Get(HttpContext));
    [HttpGet, Endpoint(EndpointId.PermissionList), ProducesResponseType<Success<IReadOnlyList<PermissionResult>>>(200)]
    public async Task<ActionResult<Success<IReadOnlyList<PermissionResult>>>> List(CancellationToken ct) => Ok(new Success<IReadOnlyList<PermissionResult>>(await cache.ReadAsync("permissions:list:" + Context.Actor?.Id, registry.Get(HttpContext).Cache == CacheMode.Read, service.PermissionsAsync, rows => rows.All(r => r.Id != Guid.Empty && !string.IsNullOrEmpty(r.Name)), ct)));
    [HttpGet("{id}"), Endpoint(EndpointId.PermissionGet), ProducesResponseType<Success<PermissionResult>>(200)]
    public async Task<ActionResult<Success<PermissionResult>>> Get(Guid id, CancellationToken ct) => Ok(new Success<PermissionResult>(await cache.ReadAsync("permission:" + Context.Actor?.Id + ":" + id, registry.Get(HttpContext).Cache == CacheMode.Read, token => service.PermissionAsync(id, token), r => r.Id == id && !string.IsNullOrEmpty(r.Name), ct)));
    [HttpPost, Endpoint(EndpointId.PermissionCreate), ProducesResponseType<Success<PermissionResult>>(201)]
    public async Task<ActionResult<Success<PermissionResult>>> Create(CreatePermissionRequest input, CancellationToken ct) => StatusCode(201, new Success<PermissionResult>(await service.CreatePermissionAsync(input.Name, Context, ct)));
    [HttpPatch("{id}"), Endpoint(EndpointId.PermissionUpdate), ProducesResponseType<Success<PermissionResult>>(200)]
    public async Task<ActionResult<Success<PermissionResult>>> Update(Guid id, UpdatePermissionRequest input, CancellationToken ct) => Ok(new Success<PermissionResult>(await service.UpdatePermissionAsync(id, input.Name, Context, ct)));
    [HttpDelete("{id}"), Endpoint(EndpointId.PermissionDelete), ProducesResponseType(204)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await service.DeletePermissionAsync(id, Context, ct); return NoContent(); }
}
