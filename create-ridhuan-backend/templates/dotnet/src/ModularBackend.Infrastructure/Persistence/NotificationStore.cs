using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularBackend.Application;
using ModularBackend.Domain;
using ModularBackend.Infrastructure.Configuration;
using MySql.EntityFrameworkCore.Extensions;

namespace ModularBackend.Infrastructure.Persistence;

public sealed class NotificationStore(BackendDbContext db, TimeProvider clock, ILogger<NotificationStore> logger, IOptions<SmtpOptions> smtp) : INotificationStore
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
        // Serialize allocation on the existing recipient row, including the first insert.
        var users = await (db.Database.IsMySql()
            ? db.Users.FromSqlInterpolated($"SELECT * FROM users WHERE Id={recipientId.ToString("D")} FOR UPDATE")
            : db.Users.FromSqlInterpolated($"SELECT *, xmin FROM users WHERE \"Id\"={recipientId} FOR UPDATE")).IgnoreQueryFilters().AsNoTracking().ToListAsync(ct);
        var recipient = users.SingleOrDefault();
        if (recipient is null || recipient.DeletedAt is not null) throw new ApiException(404, "Recipient not found");
        var counter = await db.NotificationCounters.SingleOrDefaultAsync(x => x.RecipientId == recipientId, ct);
        if (counter is null) { counter = new() { RecipientId = recipientId }; db.NotificationCounters.Add(counter); }
        counter.Sequence = checked(counter.Sequence + 1);
        var value = new Notification
        {
            RecipientId = recipientId,
            ActorId = actor.Id,
            Title = title,
            Body = body,
            Sequence = counter.Sequence,
            EmailStatus = sendEmail ? smtp.Value.Enabled ? "PENDING" : "FAILED" : "NOT_REQUESTED",
            CreatedAt = clock.GetUtcNow()
        };
        db.Notifications.Add(value);
        if (sendEmail && smtp.Value.Enabled) db.EmailJobs.Add(new()
        {
            NotificationId = value.Id,
            Recipient = recipient.Email,
            Title = title,
            Body = body,
            AvailableAt = clock.GetUtcNow(),
            CreatedAt = clock.GetUtcNow()
        });
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
    public async Task<long?> CursorAsync(Guid recipientId, Guid? cursor, CancellationToken ct)
    {
        if (cursor is null) return null;
        return await db.Notifications.AsNoTracking().Where(x => x.Id == cursor && x.RecipientId == recipientId)
            .Select(x => (long?)x.Sequence).SingleOrDefaultAsync(ct) ?? throw new ApiException(400, "Unknown notification cursor");
    }
    public async Task<IReadOnlyList<Notification>> PageAsync(Guid recipientId, long? before, CancellationToken ct) =>
        await db.Notifications.AsNoTracking().Where(x => x.RecipientId == recipientId && (before == null || x.Sequence < before))
            .OrderByDescending(x => x.Sequence).Take(51).ToArrayAsync(ct);
    public async Task<IReadOnlyList<Notification>?> StreamBatchAsync(Guid recipientId, long? after, CancellationToken ct, bool unreadOnly = false)
    {
        if (!await db.Users.AsNoTracking().AnyAsync(x => x.Id == recipientId, ct)) return null;
        return await db.Notifications.AsNoTracking().Where(x => x.RecipientId == recipientId && (!unreadOnly || x.ReadAt == null) && (after == null || x.Sequence > after))
            .OrderBy(x => x.Sequence).Take(50).ToArrayAsync(ct);
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
            logger.LogWarning("Optional notification audit failed for {EndpointId}: {ErrorType}", context.EndpointId, ex.GetType().Name);
        }
    }
}
