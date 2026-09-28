using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Observability;
using ModularBackend.Infrastructure.Persistence;
using StackExchange.Redis;

namespace ModularBackend.Infrastructure.Caching;

public sealed class RedisConnection(IOptions<RedisOptions> options) : IDisposable
{
    private readonly Lazy<ConnectionMultiplexer> connection = new(() =>
    {
        var config = ConfigurationOptions.Parse(options.Value.ConnectionString);
        config.AbortOnConnectFail = false; config.ConnectTimeout = 1000; config.AsyncTimeout = 1000; config.ConnectRetry = 0;
        return ConnectionMultiplexer.Connect(config);
    });
    public IDatabase Database => connection.Value.GetDatabase();
    public void Dispose() { if (connection.IsValueCreated) connection.Value.Dispose(); }
}
public sealed class ResponseCache(RedisConnection redis, BackendDbContext db, IOptions<CacheOptions> options, ILogger<ResponseCache> logger) : ICacheInvalidation
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow, RespectNullableAnnotations = true, RespectRequiredConstructorParameters = true };
    public async Task<T> ReadAsync<T>(string key, bool allowed, Func<CancellationToken, Task<T>> factory, Func<T, bool> valid, CancellationToken ct) where T : class
    {
        if (!options.Value.Enabled || !allowed) return await factory(ct);
        using var activity = BackendTelemetry.Redis.StartActivity("cache.read");
        string? cacheKey = null;
        try
        {
            var generation = await db.CacheGenerations.AsNoTracking().Where(x => x.Id == 1).Select(x => x.Version).SingleAsync(ct);
            cacheKey = options.Value.Prefix + ":" + generation + ":" + key;
            var raw = await redis.Database.StringGetAsync(cacheKey).WaitAsync(ct);
            if (!raw.IsNull) { var result = JsonSerializer.Deserialize<T>(raw.ToString(), Json); if (result is not null && valid(result)) return result; }
        }
        catch (Exception ex) when (ex is RedisException or JsonException or ArgumentException) { logger.LogDebug("Cache read miss: {ErrorType}", ex.GetType().Name); }
        var fresh = await factory(ct);
        if (cacheKey is not null)
            try { await redis.Database.StringSetAsync(cacheKey, JsonSerializer.Serialize(fresh, Json), TimeSpan.FromSeconds(options.Value.TtlSeconds)).WaitAsync(ct); }
            catch (RedisException) { logger.LogDebug("Cache write unavailable"); }
        return fresh;
    }
    public async Task InvalidateAsync(CancellationToken ct)
    {
        if (!options.Value.Enabled) return;
        try { await redis.Database.StringIncrementAsync(options.Value.Prefix + ":generation").WaitAsync(ct); }
        catch (Exception ex) when (ex is RedisException or OperationCanceledException) { logger.LogWarning("Cache invalidation unavailable; cached values expire at TTL"); }
    }
}
