using System.Data.Common;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using ModularBackend.Api.Authorization;
using ModularBackend.Api.Contracts;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Observability;

namespace ModularBackend.Api.Controllers;

[ApiController, Route("api/notifications")]
public sealed class NotificationsController(
    NotificationService service,
    EndpointRegistry registry,
    ILogger<NotificationsController> logger
) : ControllerBase
{
    private OperationContext Context =>
        EndpointFilter.Context(HttpContext, registry.Get(HttpContext));

    [
        HttpPost,
        Endpoint(EndpointId.NotificationCreate),
        ProducesResponseType<Success<NotificationResult>>(201)
    ]
    public async Task<ActionResult<Success<NotificationResult>>> Create(
        CreateNotificationRequest input,
        CancellationToken ct
    ) =>
        StatusCode(
            201,
            new Success<NotificationResult>(
                await service.CreateAsync(
                    input.RecipientId,
                    input.Title,
                    input.Body,
                    input.SendEmail,
                    Context,
                    ct
                )
            )
        );

    [
        HttpGet,
        Endpoint(EndpointId.NotificationList),
        ProducesResponseType<Success<IReadOnlyList<NotificationResult>>>(200)
    ]
    public async Task<ActionResult<Success<IReadOnlyList<NotificationResult>>>> List(
        [FromQuery] Guid? cursor,
        CancellationToken ct
    )
    {
        var page = await service.PageAsync(
            Context.Actor?.Id ?? throw new ApiException(401, "Unauthorized"),
            cursor,
            ct
        );
        if (page.Next is { } next)
            Response.Headers["X-Next-Cursor"] = next.ToString("D");
        return Ok(new Success<IReadOnlyList<NotificationResult>>(page.Items));
    }

    [
        HttpPatch("{id}/read"),
        Endpoint(EndpointId.NotificationRead),
        ProducesResponseType<Success<NotificationResult>>(200)
    ]
    public async Task<ActionResult<Success<NotificationResult>>> Read(
        Guid id,
        CancellationToken ct
    ) => Ok(new Success<NotificationResult>(await service.MarkReadAsync(id, Context, ct)));

    [HttpGet("stream"), Endpoint(EndpointId.NotificationStream), Produces("text/event-stream")]
    public async Task Stream(CancellationToken ct)
    {
        var actorId = Context.Actor?.Id ?? throw new ApiException(401, "Unauthorized");
        var expiresAt = long.TryParse(User.FindFirst("exp")?.Value, out var seconds)
            ? DateTimeOffset.FromUnixTimeSeconds(seconds)
            : throw new ApiException(401, "Invalid access token");
        var rawCursor = Request.Headers["Last-Event-ID"].ToString();
        if (rawCursor.Length > 0 && !Guid.TryParseExact(rawCursor, "D", out _))
            throw new ApiException(400, "Invalid notification cursor");
        var unreadOnly = rawCursor.Length == 0;
        var cursor = await service.CursorAsync(
            actorId,
            rawCursor.Length == 0 ? null : Guid.Parse(rawCursor),
            ct
        );
        Response.StatusCode = 200;
        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache, no-transform";
        Response.Headers["X-Accel-Buffering"] = "no";
        await Response.StartAsync(ct);
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(ct);
        lifetime.CancelAfter(
            TimeSpan.FromMinutes(14) < expiresAt - TimeProvider.System.GetUtcNow()
                ? TimeSpan.FromMinutes(14)
                : TimeSpan.FromTicks(
                    Math.Max(1, (expiresAt - TimeProvider.System.GetUtcNow()).Ticks)
                )
        );
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
        var lastHeartbeat = TimeProvider.System.GetUtcNow();
        BackendTelemetry.Sse.Add(1);
        try
        {
            do
            {
                var rows = await service.StreamBatchAsync(
                    actorId,
                    cursor,
                    lifetime.Token,
                    unreadOnly
                );
                if (rows is null)
                    break;
                foreach (var row in rows)
                {
                    await Response.WriteAsync(
                        $"id: {row.Item.Id}\nevent: notification\ndata: {JsonSerializer.Serialize(row.Item, new JsonSerializerOptions(JsonSerializerDefaults.Web))}\n\n",
                        lifetime.Token
                    );
                    await Response.Body.FlushAsync(lifetime.Token);
                    cursor = row.Sequence;
                }
                if (TimeProvider.System.GetUtcNow() - lastHeartbeat >= TimeSpan.FromSeconds(15))
                {
                    await Response.WriteAsync(": heartbeat\n\n", lifetime.Token);
                    lastHeartbeat = TimeProvider.System.GetUtcNow();
                }
                await Response.Body.FlushAsync(lifetime.Token);
                if (rows.Count == 50)
                    continue;
                if (!await timer.WaitForNextTickAsync(lifetime.Token))
                    break;
            } while (!lifetime.IsCancellationRequested);
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception ex) when (ex is DbException || ex.InnerException is DbException)
        {
            // Headers have already been sent. End the stream cleanly so the
            // client can resume from its last UUID once persistence recovers.
            logger.LogWarning(
                "Notification stream closed: persistence unavailable; {ErrorType}",
                ex.GetType().Name
            );
        }
        finally
        {
            BackendTelemetry.Sse.Add(-1);
        }
    }
}
