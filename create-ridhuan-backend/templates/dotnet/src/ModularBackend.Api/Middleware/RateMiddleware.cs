using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.Extensions.Options;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Caching;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Observability;
using StackExchange.Redis;

namespace ModularBackend.Api.Middleware;

public sealed class EndpointLimiter(
    IOptions<RateOptions> options,
    RedisConnection redis,
    ILogger<EndpointLimiter> logger
) : IDisposable
{
    private readonly PartitionedRateLimiter<string> memory = PartitionedRateLimiter.Create<
        string,
        string
    >(key =>
    {
        var group = Enum.Parse<RateLimitGroup>(key.Split(':')[0]);
        var window = group switch
        {
            RateLimitGroup.Auth => options.Value.Auth,
            RateLimitGroup.Internal => options.Value.Internal,
            _ => options.Value.Public,
        };
        return RateLimitPartition.GetFixedWindowLimiter(
            key,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = window.Max,
                Window = TimeSpan.FromMilliseconds(window.WindowMs),
                AutoReplenishment = true,
                QueueLimit = 0,
            }
        );
    });
    private long lastFailureLog;

    public async Task<int> CheckAsync(RateLimitGroup group, string identity, CancellationToken ct)
    {
        var key =
            group + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)));
        if (options.Value.Store == "memory")
        {
            using var lease = await memory.AcquireAsync(key, 1, ct);
            return lease.IsAcquired ? 200 : 429;
        }
        var window = group switch
        {
            RateLimitGroup.Auth => options.Value.Auth,
            RateLimitGroup.Internal => options.Value.Internal,
            _ => options.Value.Public,
        };
        using var activity = BackendTelemetry.Redis.StartActivity("ratelimit.check");
        try
        {
            var count = (long)
                await redis
                    .Database.ScriptEvaluateAsync(
                        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return n",
                        [options.Value.Prefix + ":rate:" + key],
                        [window.WindowMs]
                    )
                    .WaitAsync(ct);
            return count <= window.Max ? 200 : 429;
        }
        catch (Exception ex) when (ex is RedisException or RedisTimeoutException)
        {
            var now = Environment.TickCount64;
            var previous = Interlocked.Read(ref lastFailureLog);
            if (
                now - previous > 30000
                && Interlocked.CompareExchange(ref lastFailureLog, now, previous) == previous
            )
                logger.LogWarning("Redis limiter unavailable; auth fails closed");
            return group == RateLimitGroup.Auth ? 503 : 200;
        }
    }

    public void Dispose() => memory.Dispose();
}

public sealed class RateMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(
        HttpContext http,
        EndpointRegistry registry,
        EndpointLimiter limiter
    )
    {
        if (http.GetEndpoint()?.Metadata.GetMetadata<EndpointAttribute>() is null)
        {
            await next(http);
            return;
        }
        var policy = registry.Get(http);
        if (policy.Module == "system")
        {
            await next(http);
            return;
        }
        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var status = await limiter.CheckAsync(RateLimitGroup.Public, ip, http.RequestAborted);
        if (status == 200 && policy.RateLimit != RateLimitGroup.Public)
        {
            var identity =
                policy.RateLimit == RateLimitGroup.Internal
                    ? http.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? ip
                    : ip;
            status = await limiter.CheckAsync(policy.RateLimit, identity, http.RequestAborted);
        }
        if (status != 200)
        {
            http.Response.StatusCode = status;
            if (status == 429)
                http.Response.Headers.RetryAfter = "60";
            await http.Response.WriteAsJsonAsync(
                new Failure(status == 429 ? "Too many requests" : "Service unavailable", []),
                http.RequestAborted
            );
            return;
        }
        await next(http);
    }
}
