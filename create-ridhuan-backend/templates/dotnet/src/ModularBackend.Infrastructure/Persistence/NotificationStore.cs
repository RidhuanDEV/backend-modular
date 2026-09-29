using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ModularBackend.Application;
using ModularBackend.Domain;

namespace ModularBackend.Infrastructure.Persistence;

public sealed class NotificationStore(BackendDbContext db, TimeProvider clock, ILogger<NotificationStore> logger) : INotificationStore
{
    public Task<string?> RecipientEmailAsync(Guid id, CancellationToken ct) => db.Users.Where(x => x.Id == id).Select(x => x.Email).SingleOrDefaultAsync(ct);
    public async Task<IReadOnlyList<Notification>> ListAsync(Guid recipientId, bool unreadOnly, CancellationToken ct)
    {
        var query = db.Notifications.AsNoTracking().Where(x => x.RecipientId == recipientId);
        if (unreadOnly) query = query.Where(x => x.ReadAt == null);
        return await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Take(50).ToArrayAsync(ct);
    }
    public async Task<Notification> CreateAsync(Guid recipientId, string title, string body, bool sendEmail, OperationContext context, CancellationToken ct)
    {
        var actor = context.Actor ?? throw new ApiException(401, "Unauthorized");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var value = new Notification
        {
            RecipientId = recipientId,
            ActorId = actor.Id,
            Title = title,
            Body = body,
            EmailStatus = sendEmail ? "PENDING" : "NOT_REQUESTED",
            CreatedAt = clock.GetUtcNow()
        };
        db.Notifications.Add(value);
        if (context.Audit == AuditMode.Required) db.ActivityLogs.Add(Log(context, value.Id, "CREATE", null,
            JsonSerializer.Serialize(new { value.Id, value.RecipientId, value.Title, EmailRequested = sendEmail })));
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        if (context.Audit == AuditMode.Optional) await OptionalAuditAsync(context, value.Id, "CREATE", null,
            JsonSerializer.Serialize(new { value.Id, value.RecipientId, value.Title, EmailRequested = sendEmail }), ct);
        return value;
    }
    public async Task<Notification> MarkReadAsync(Guid id, OperationContext context, CancellationToken ct)
    {
        var actor = context.Actor ?? throw new ApiException(401, "Unauthorized");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var value = await db.Notifications.SingleOrDefaultAsync(x => x.Id == id && x.RecipientId == actor.Id, ct)
            ?? throw new ApiException(404, "Notification not found");
        var before = JsonSerializer.Serialize(new { value.ReadAt });
        value.ReadAt ??= clock.GetUtcNow();
        var after = JsonSerializer.Serialize(new { value.ReadAt });
        if (context.Audit == AuditMode.Required) db.ActivityLogs.Add(Log(context, id, "UPDATE", before, after));
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        if (context.Audit == AuditMode.Optional) await OptionalAuditAsync(context, id, "UPDATE", before, after, ct);
        return value;
    }
    public async Task<Notification> SetEmailStatusAsync(Guid id, string status, CancellationToken ct)
    {
        var value = await db.Notifications.SingleAsync(x => x.Id == id, ct);
        value.EmailStatus = status; await db.SaveChangesAsync(ct); return value;
    }
    private ActivityLog Log(OperationContext context, Guid id, string behavior, string? before, string? after) =>
        new()
        {
            Module = context.Module,
            EndpointId = context.EndpointId,
            RequestId = context.RequestId,
            Behavior = behavior,
            EntityId = id,
            UserId = context.Actor?.Id,
            ActorIdSnapshot = context.Actor?.Id,
            ActorEmailSnapshot = context.Actor?.Email,
            Before = before,
            After = after,
            CreatedAt = clock.GetUtcNow()
        };
    private async Task OptionalAuditAsync(OperationContext context, Guid id, string behavior, string? before, string? after, CancellationToken ct)
    {
        var entry = db.ActivityLogs.Add(Log(context, id, behavior, before, after));
        try { await db.SaveChangesAsync(ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            entry.State = EntityState.Detached;
            logger.LogWarning(ex, "Optional notification audit failed for {EndpointId}", context.EndpointId);
        }
    }
}
