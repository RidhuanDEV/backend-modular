using ModularBackend.Domain;

namespace ModularBackend.Application;

public sealed class NotificationService(INotificationStore store)
{
    private static NotificationResult Project(Notification value) => new(value.Id, value.RecipientId, value.Title, value.Body, value.EmailStatus, value.ReadAt, value.CreatedAt);
    public async Task<NotificationResult> CreateAsync(Guid recipientId, string title, string body, bool sendEmail, OperationContext context, CancellationToken ct)
    {
        if (context.Actor is null) throw new ApiException(401, "Unauthorized");
        title = title.Trim(); body = body.Trim();
        if (title.Length is < 1 or > 160 || body.Length is < 1 or > 4000) throw new ApiException(400, "Invalid notification");
        var created = await store.CreateAsync(recipientId, title, body, sendEmail, context, ct);
        return Project(created);
    }
    public async Task<IReadOnlyList<NotificationResult>> ListAsync(Guid actorId, CancellationToken ct) => (await store.ListAsync(actorId, false, ct)).Select(Project).ToArray();
    public async Task<IReadOnlyList<NotificationResult>> UnreadAsync(Guid actorId, CancellationToken ct) => (await store.ListAsync(actorId, true, ct)).Select(Project).ToArray();
    public async Task<NotificationResult> MarkReadAsync(Guid id, OperationContext context, CancellationToken ct) => Project(await store.MarkReadAsync(id, context, ct));
    public Task<long?> CursorAsync(Guid actorId, Guid? cursor, CancellationToken ct) => store.CursorAsync(actorId, cursor, ct);
    public async Task<(IReadOnlyList<NotificationResult> Items, Guid? Next)> PageAsync(Guid actorId, Guid? cursor, CancellationToken ct)
    {
        var rows = await store.PageAsync(actorId, await store.CursorAsync(actorId, cursor, ct), ct);
        return (rows.Take(50).Select(Project).ToArray(), rows.Count > 50 ? rows[49].Id : null);
    }
    public async Task<IReadOnlyList<(NotificationResult Item, long Sequence)>?> StreamBatchAsync(Guid actorId, long? after, CancellationToken ct, bool unreadOnly = false)
    {
        var rows = await store.StreamBatchAsync(actorId, after, ct, unreadOnly);
        return rows?.Select(row => (Project(row), row.Sequence)).ToArray();
    }
}
