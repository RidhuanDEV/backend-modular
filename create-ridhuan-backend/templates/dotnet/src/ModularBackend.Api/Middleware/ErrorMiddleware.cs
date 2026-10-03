using System.Diagnostics;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Observability;

namespace ModularBackend.Api.Middleware;

public sealed class ErrorMiddleware(
    RequestDelegate next,
    ILogger<ErrorMiddleware> logger,
    EndpointRegistry registry
)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var supplied = context.Request.Headers["X-Request-ID"].ToString();
        context.TraceIdentifier =
            supplied.Length is > 0 and <= 64
            && supplied.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_')
                ? supplied
                : Guid.NewGuid().ToString("N");
        context.Response.Headers["X-Request-ID"] = context.TraceIdentifier;
        using var activity = BackendTelemetry.Source.StartActivity(
            "http.server",
            ActivityKind.Server
        );
        using var scope = logger.BeginScope(
            new Dictionary<string, string>
            {
                ["RequestId"] = context.TraceIdentifier,
                ["TraceId"] = Activity.Current?.TraceId.ToString() ?? "",
                ["SpanId"] = Activity.Current?.SpanId.ToString() ?? "",
            }
        );
        var timer = Stopwatch.StartNew();
        try
        {
            await next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            context.Abort();
        }
        catch (Exception ex)
        {
            if (context.Response.HasStarted)
            {
                context.Abort();
                return;
            }
            context.Response.Clear();
            context.Response.Headers["X-Request-ID"] = context.TraceIdentifier;
            context.Response.StatusCode = ex switch
            {
                ApiException api => api.Status,
                BadHttpRequestException bad => bad.StatusCode,
                Npgsql.NpgsqlException => 503,
                MySql.Data.MySqlClient.MySqlException => 503,
                InvalidDataException => 400,
                _ => 500,
            };
            if (context.Response.StatusCode >= 500)
                logger.LogError(
                    "Request failed: {ErrorType}; {ErrorOrigin}",
                    ex.GetType().Name,
                    ex.TargetSite?.DeclaringType?.FullName + "." + ex.TargetSite?.Name
                );
            var message =
                ex is ApiException known && known.Status < 500
                    ? known.Message
                    : context.Response.StatusCode switch
                    {
                        413 => "Request body too large",
                        400 => "Invalid request",
                        503 => "Service unavailable",
                        _ => "Internal server error",
                    };
            await context.Response.WriteAsJsonAsync(
                new Failure(message, []),
                context.RequestAborted
            );
        }
        finally
        {
            var operation = context.GetEndpoint()?.Metadata.GetMetadata<EndpointAttribute>()
                is { } metadata
                ? registry.Policies[metadata.Id].WireId
                : "unregistered";
            activity?.SetTag("operationId", operation);
            activity?.SetTag("status", context.Response.StatusCode);
            if (context.Response.StatusCode >= 500)
                activity?.SetStatus(ActivityStatusCode.Error);
            var tags = new TagList
            {
                { "operationId", operation },
                { "status", context.Response.StatusCode },
            };
            BackendTelemetry.Requests.Add(1, tags);
            BackendTelemetry.Duration.Record(timer.Elapsed.TotalSeconds, tags);
            if (context.Response.StatusCode >= 500)
                BackendTelemetry.Errors.Add(1, tags);
            logger.LogInformation(
                "HTTP {Method} {Status} in {DurationMs}ms; {EndpointId}",
                context.Request.Method,
                context.Response.StatusCode,
                timer.ElapsedMilliseconds,
                operation
            );
        }
    }
}
