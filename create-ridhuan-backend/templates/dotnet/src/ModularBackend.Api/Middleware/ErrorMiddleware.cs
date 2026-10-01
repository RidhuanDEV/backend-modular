using System.Diagnostics;
using ModularBackend.Application;

namespace ModularBackend.Api.Middleware;

public sealed class ErrorMiddleware(RequestDelegate next, ILogger<ErrorMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var supplied = context.Request.Headers["X-Request-ID"].ToString();
        context.TraceIdentifier = supplied.Length is > 0 and <= 64 && supplied.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') ? supplied : Guid.NewGuid().ToString("N");
        context.Response.Headers["X-Request-ID"] = context.TraceIdentifier;
        using var scope = logger.BeginScope(new Dictionary<string, string> { ["RequestId"] = context.TraceIdentifier });
        var timer = Stopwatch.StartNew();
        try { await next(context); }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { context.Abort(); }
        catch (Exception ex)
        {
            if (context.Response.HasStarted) { context.Abort(); return; }
            context.Response.Clear(); context.Response.Headers["X-Request-ID"] = context.TraceIdentifier;
            context.Response.StatusCode = ex switch { ApiException api => api.Status, BadHttpRequestException bad => bad.StatusCode, Npgsql.NpgsqlException => 503, MySql.Data.MySqlClient.MySqlException => 503, InvalidDataException => 400, _ => 500 };
            // Log the exception itself: a type name alone makes production failures undiagnosable. Logs are server-side only.
            if (context.Response.StatusCode >= 500) logger.LogError(ex, "Request failed: {ErrorType}", ex.GetType().Name);
            var message = ex is ApiException known && known.Status < 500 ? known.Message : context.Response.StatusCode switch { 413 => "Request body too large", 400 => "Invalid request", 503 => "Service unavailable", _ => "Internal server error" };
            await context.Response.WriteAsJsonAsync(new Failure(message, []), context.RequestAborted);
        }
        finally { logger.LogInformation("HTTP {Method} {Path} {Status} in {DurationMs}ms; {EndpointId} actor {ActorId}", context.Request.Method, context.Request.Path, context.Response.StatusCode, timer.ElapsedMilliseconds, context.GetEndpoint()?.Metadata.GetMetadata<ModularBackend.Api.Endpoints.EndpointAttribute>()?.Id.ToString() ?? "unmapped", context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "anonymous"); }
    }
}
