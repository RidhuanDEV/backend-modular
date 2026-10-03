using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Caching;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Persistence;

namespace ModularBackend.Api.Controllers;

[ApiController]
public sealed class SystemController(
    BackendDbContext db,
    RedisConnection redis,
    IOptions<RateOptions> rate
) : ControllerBase
{
    [
        HttpGet("health"),
        Endpoint(EndpointId.HealthGet),
        ProducesResponseType<Success<StatusResult>>(200)
    ]
    public ActionResult<Success<StatusResult>> Health() => Ok(new Success<StatusResult>(new("ok")));

    [
        HttpGet("live"),
        Endpoint(EndpointId.LiveGet),
        ProducesResponseType<Success<StatusResult>>(200)
    ]
    public ActionResult<Success<StatusResult>> Live() => Ok(new Success<StatusResult>(new("ok")));

    [
        HttpGet("ready"),
        Endpoint(EndpointId.ReadyGet),
        ProducesResponseType<Success<StatusResult>>(200)
    ]
    public async Task<ActionResult<Success<StatusResult>>> Ready(CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            if (!await db.Database.CanConnectAsync(timeout.Token))
                throw new ApiException(503, "Service unavailable");
            if (rate.Value.Store == "redis")
                await redis.Database.PingAsync().WaitAsync(timeout.Token);
        }
        catch (Exception ex) when (ex is not ApiException)
        {
            throw new ApiException(503, "Service unavailable");
        }
        return Ok(new Success<StatusResult>(new("ok")));
    }
}
