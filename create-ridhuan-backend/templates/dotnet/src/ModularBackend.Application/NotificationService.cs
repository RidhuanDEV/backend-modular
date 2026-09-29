using ModularBackend.Domain;

namespace ModularBackend.Application;

public sealed class NotificationService(INotificationStore store, INotificationMailSender mail, IAuditFailureReporter reporter)
{
    private static NotificationResult Project(Notification value) => new(value.Id, value.RecipientId, value.Title, value.Body, value.EmailStatus, value.ReadAt, value.CreatedAt);
    public async Task<NotificationResult> CreateAsync(Guid recipientId, string title, string body, bool sendEmail, OperationContext context, CancellationToken ct)
    {
        if (context.Actor is null) throw new ApiException(401, "Unauthorized");
        title = title.Trim(); body = body.Trim();
        if (title.Length is < 1 or > 160 || body.Length is < 1 or > 4000) throw new ApiException(400, "Invalid notification");
        var email = await store.RecipientEmailAsync(recipientId, ct) ?? throw new ApiException(404, "Recipient not found");
        var created = await store.CreateAsync(recipientId, title, body, sendEmail, context, ct);
        if (!sendEmail) return Project(created);
        var status = "FAILED";
        if (mail.Enabled)
        {
            try { await mail.SendAsync(email, title, body, ct); status = "SENT"; }
            catch (Exception ex) when (ex is not OperationCanceledException) { reporter.Report(ex, context.EndpointId); }
        }
        return Project(await store.SetEmailStatusAsync(created.Id, status, ct));
    }
    public async Task<IReadOnlyList<NotificationResult>> ListAsync(Guid actorId, CancellationToken ct) => (await store.ListAsync(actorId, false, ct)).Select(Project).ToArray();
    public async Task<IReadOnlyList<NotificationResult>> UnreadAsync(Guid actorId, CancellationToken ct) => (await store.ListAsync(actorId, true, ct)).Select(Project).ToArray();
    public async Task<NotificationResult> MarkReadAsync(Guid id, OperationContext context, CancellationToken ct) => Project(await store.MarkReadAsync(id, context, ct));
}
