using Microsoft.AspNetCore.Mvc;
using ModularBackend.Api.Authorization;
using ModularBackend.Api.Contracts;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Caching;
namespace ModularBackend.Api.Controllers;

[ApiController, Route("api/auth")]
public sealed class AuthController(BackendService service, EndpointRegistry registry) : ControllerBase
{
    private OperationContext Context => EndpointFilter.Context(HttpContext, registry.Get(HttpContext));
    [HttpPost("register"), Endpoint(EndpointId.AuthRegister), ProducesResponseType<Success<AuthUserResult>>(201)]
    public async Task<ActionResult<Success<AuthUserResult>>> Register(RegisterRequest input, CancellationToken ct) => StatusCode(201, new Success<AuthUserResult>(await service.RegisterAsync(input.Email, input.Password, Context, ct)));
    [HttpPost("login"), Endpoint(EndpointId.AuthLogin), ProducesResponseType<Success<AuthTokensResult>>(200)]
    public async Task<ActionResult<Success<AuthTokensResult>>> Login(LoginRequest input, CancellationToken ct) => Ok(new Success<AuthTokensResult>(await service.LoginAsync(input.Email, input.Password, Context, ct)));
    [HttpPost("refresh"), Endpoint(EndpointId.AuthRefresh), ProducesResponseType<Success<AuthTokensResult>>(200)]
    public async Task<ActionResult<Success<AuthTokensResult>>> Refresh(RefreshTokenRequest input, CancellationToken ct) => Ok(new Success<AuthTokensResult>(await service.RefreshAsync(input.RefreshToken, Context, ct)));
    [HttpPost("logout"), Endpoint(EndpointId.AuthLogout), ProducesResponseType(204)]
    public async Task<IActionResult> Logout(RefreshTokenRequest input, CancellationToken ct)
    {
        await service.LogoutAsync(input.RefreshToken, Context, ct);
        return NoContent();
    }
    [HttpGet("me"), Endpoint(EndpointId.AuthMe), ProducesResponseType<Success<AuthUserResult>>(200)]
    public async Task<ActionResult<Success<AuthUserResult>>> Me(CancellationToken ct) => Ok(new Success<AuthUserResult>(await service.MeAsync(Context.Actor?.Id ?? throw new ApiException(401, "Unauthorized"), ct)));
}
