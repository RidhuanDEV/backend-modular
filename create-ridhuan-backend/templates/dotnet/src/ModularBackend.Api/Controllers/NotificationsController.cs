using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using ModularBackend.Api.Authorization;
using ModularBackend.Api.Contracts;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;

namespace ModularBackend.Api.Controllers;

[ApiController, Route("api/notifications")]
public sealed class NotificationsController(NotificationService service, EndpointRegistry registry) : ControllerBase
{
    private OperationContext Context => EndpointFilter.Context(HttpContext, registry.Get(HttpContext));
    [HttpPost, Endpoint(EndpointId.NotificationCreate), ProducesResponseType<Success<NotificationResult>>(201)]
    public async Task<ActionResult<Success<NotificationResult>>> Create(CreateNotificationRequest input, CancellationToken ct) =>
        StatusCode(201, new Success<NotificationResult>(await service.CreateAsync(input.RecipientId, input.Title, input.Body, input.SendEmail, Context, ct)));

    [HttpGet, Endpoint(EndpointId.NotificationList), ProducesResponseType<Success<IReadOnlyList<NotificationResult>>>(200)]
    public async Task<ActionResult<Success<IReadOnlyList<NotificationResult>>>> List(CancellationToken ct) =>
        Ok(new Success<IReadOnlyList<NotificationResult>>(await service.ListAsync(Context.Actor?.Id ?? throw new ApiException(401, "Unauthorized"), ct)));

    [HttpPatch("{id}/read"), Endpoint(EndpointId.NotificationRead), ProducesResponseType<Success<NotificationResult>>(200)]
    public async Task<ActionResult<Success<NotificationResult>>> Read(Guid id, CancellationToken ct) =>
        Ok(new Success<NotificationResult>(await service.MarkReadAsync(id, Context, ct)));

    [HttpGet("stream"), Endpoint(EndpointId.NotificationStream), Produces("text/event-stream")]
    public async Task Stream(CancellationToken ct)
    {
        var actorId = Context.Actor?.Id ?? throw new ApiException(401, "Unauthorized");
        var expiresAt = long.TryParse(User.FindFirst("exp")?.Value, out var seconds)
            ? DateTimeOffset.FromUnixTimeSeconds(seconds) : throw new ApiException(401, "Invalid access token");
        Response.StatusCode = 200;
        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache, no-transform";
        Response.Headers["X-Accel-Buffering"] = "no";
        await Response.StartAsync(ct);
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(ct);
        lifetime.CancelAfter(TimeSpan.FromMinutes(14) < expiresAt - TimeProvider.System.GetUtcNow()
            ? TimeSpan.FromMinutes(14) : TimeSpan.FromTicks(Math.Max(1, (expiresAt - TimeProvider.System.GetUtcNow()).Ticks)));
        var sent = new HashSet<Guid>();
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
        var lastHeartbeat = TimeProvider.System.GetUtcNow();
        try
        {
            do
            {
                var rows = await service.UnreadAsync(actorId, lifetime.Token);
                foreach (var row in rows.Reverse())
                {
                    if (!sent.Add(row.Id)) continue;
                    await Response.WriteAsync($"id: {row.Id}\nevent: notification\ndata: {JsonSerializer.Serialize(row, new JsonSerializerOptions(JsonSerializerDefaults.Web))}\n\n", lifetime.Token);
                }
                if (TimeProvider.System.GetUtcNow() - lastHeartbeat >= TimeSpan.FromSeconds(15))
                {
                    await Response.WriteAsync(": heartbeat\n\n", lifetime.Token);
                    lastHeartbeat = TimeProvider.System.GetUtcNow();
                }
                await Response.Body.FlushAsync(lifetime.Token);
            } while (await timer.WaitForNextTickAsync(lifetime.Token));
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
    }
}
