using Microsoft.AspNetCore.Mvc;
using ModularBackend.Api.Authorization;
using ModularBackend.Api.Contracts;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Caching;
namespace ModularBackend.Api.Controllers;

[ApiController, Route("api/roles")]
public sealed class RolesController(BackendService service, EndpointRegistry registry, ResponseCache cache) : ControllerBase
{
    private OperationContext Context => EndpointFilter.Context(HttpContext, registry.Get(HttpContext));
    [HttpGet, Endpoint(EndpointId.RoleList), ProducesResponseType<Success<IReadOnlyList<RoleResult>>>(200)]
    public async Task<ActionResult<Success<IReadOnlyList<RoleResult>>>> List(CancellationToken ct) => Ok(new Success<IReadOnlyList<RoleResult>>(await cache.ReadAsync("roles:list:" + Context.Actor?.Id, registry.Get(HttpContext).Cache == CacheMode.Read, service.RolesAsync, rows => rows.All(r => r.Id != Guid.Empty && !string.IsNullOrEmpty(r.Name)), ct)));
    [HttpGet("{id}"), Endpoint(EndpointId.RoleGet), ProducesResponseType<Success<RoleResult>>(200)]
    public async Task<ActionResult<Success<RoleResult>>> Get(Guid id, CancellationToken ct) => Ok(new Success<RoleResult>(await cache.ReadAsync("role:" + Context.Actor?.Id + ":" + id, registry.Get(HttpContext).Cache == CacheMode.Read, token => service.RoleAsync(id, token), r => r.Id == id && !string.IsNullOrEmpty(r.Name), ct)));
    [HttpPost, Endpoint(EndpointId.RoleCreate), ProducesResponseType<Success<RoleResult>>(201)]
    public async Task<ActionResult<Success<RoleResult>>> Create(CreateRoleRequest input, CancellationToken ct) => StatusCode(201, new Success<RoleResult>(await service.CreateRoleAsync(input.Name, Context, ct)));
    [HttpPatch("{id}"), Endpoint(EndpointId.RoleUpdate), ProducesResponseType<Success<RoleResult>>(200)]
    public async Task<ActionResult<Success<RoleResult>>> Update(Guid id, UpdateRoleRequest input, CancellationToken ct) => Ok(new Success<RoleResult>(await service.UpdateRoleAsync(id, input.Name, Context, ct)));
    [HttpDelete("{id}"), Endpoint(EndpointId.RoleDelete), ProducesResponseType(204)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await service.DeleteRoleAsync(id, Context, ct); return NoContent(); }
    [HttpPost("{id}/permissions"), Endpoint(EndpointId.RoleAssignPermissions), ProducesResponseType<Success<RoleResult>>(200)]
    public async Task<ActionResult<Success<RoleResult>>> Assign(Guid id, AssignPermissionsRequest input, CancellationToken ct) => Ok(new Success<RoleResult>(await service.AssignPermissionsAsync(id, input.PermissionIds, Context, ct)));
}
