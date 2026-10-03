using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularBackend.Application;
using ModularBackend.Domain;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Observability;
using ModularBackend.Infrastructure.Persistence;
using MySql.EntityFrameworkCore.Extensions;

namespace ModularBackend.Infrastructure.Jobs;

public sealed class EmailWorker(
    IServiceScopeFactory scopes,
    INotificationMailSender mail,
    IOptions<WorkerOptions> options,
    ILogger<EmailWorker> logger
) : BackgroundService
{
    private static readonly int[] RetrySeconds = [5, 30, 120, 600];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!mail.Enabled)
        {
            logger.LogInformation("SMTP disabled; worker is idle until shutdown");
            try
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            return;
        }
        await Task.WhenAll(
            Enumerable.Range(0, options.Value.Concurrency).Select(_ => ConsumeAsync(stoppingToken))
        );
    }

    private async Task ConsumeAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var job = await ClaimAsync(ct);
                if (job is not null)
                {
                    await DeliverAsync(job, ct);
                    continue;
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception)
            {
                logger.LogWarning("Email persistence unavailable");
            }
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(options.Value.PollSeconds), ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task<EmailJob?> ClaimAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BackendDbContext>();
        var pending = db.EmailJobs.Where(x => x.Status == "PENDING" || x.Status == "PROCESSING");
        BackendTelemetry.Backlog.Record(await pending.LongCountAsync(ct));
        var oldest = await pending.Select(x => (DateTimeOffset?)x.CreatedAt).MinAsync(ct);
        BackendTelemetry.Oldest.Record(
            oldest is null ? 0 : Math.Max(0, (DateTimeOffset.UtcNow - oldest.Value).TotalSeconds)
        );
        await using var tx = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.ReadCommitted,
            ct
        );
        var now = DateTimeOffset.UtcNow;
        var rows = await (
            db.Database.IsMySql()
                ? db.EmailJobs.FromSqlInterpolated(
                    $"SELECT * FROM email_jobs WHERE (Status='PENDING' AND AvailableAt<={now.UtcDateTime}) OR (Status='PROCESSING' AND LeaseUntil<={now.UtcDateTime}) ORDER BY AvailableAt,Id LIMIT 1 FOR UPDATE SKIP LOCKED"
                )
                : db.EmailJobs.FromSqlInterpolated(
                    $"SELECT * FROM email_jobs WHERE (\"Status\"='PENDING' AND \"AvailableAt\"<={now}) OR (\"Status\"='PROCESSING' AND \"LeaseUntil\"<={now}) ORDER BY \"AvailableAt\",\"Id\" LIMIT 1 FOR UPDATE SKIP LOCKED"
                )
        ).ToListAsync(ct);
        var job = rows.SingleOrDefault();
        if (job is null)
            return null;
        if (job.Attempts >= options.Value.MaxAttempts)
        {
            job.Status = "FAILED";
            job.CompletedAt = now;
            job.LeaseId = null;
            job.LeaseUntil = null;
            await db
                .Notifications.Where(x => x.Id == job.NotificationId)
                .ExecuteUpdateAsync(u => u.SetProperty(x => x.EmailStatus, "FAILED"), ct);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return null;
        }
        job.Status = "PROCESSING";
        job.Attempts++;
        job.LeaseId = Guid.NewGuid();
        job.LeaseUntil = now.AddSeconds(options.Value.LeaseSeconds);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return job;
    }

    private async Task<bool> RenewAsync(EmailJob job, CancellationToken ct)
    {
        try
        {
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(options.Value.RenewSeconds), ct);
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<BackendDbContext>();
                var now = DateTimeOffset.UtcNow;
                var changed = await db
                    .EmailJobs.Where(x =>
                        x.Id == job.Id
                        && x.Status == "PROCESSING"
                        && x.LeaseId == job.LeaseId
                        && x.LeaseUntil > now
                    )
                    .ExecuteUpdateAsync(
                        u =>
                            u.SetProperty(
                                x => x.LeaseUntil,
                                now.AddSeconds(options.Value.LeaseSeconds)
                            ),
                        ct
                    );
                if (changed != 1)
                    return false;
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return true;
        }
        catch (Exception)
        {
            logger.LogWarning("Email lease renewal failed for {JobId}", job.Id);
            return false;
        }
    }

    private async Task DeliverAsync(EmailJob job, CancellationToken stoppingToken)
    {
        using var activity = BackendTelemetry.Source.StartActivity("email");
        activity?.SetTag("operationId", "notification.create");
        using var logScope = logger.BeginScope(
            new Dictionary<string, string>
            {
                ["TraceId"] = Activity.Current?.TraceId.ToString() ?? "",
                ["SpanId"] = Activity.Current?.SpanId.ToString() ?? "",
            }
        );
        // At least once: an SMTP acknowledgement followed by a process crash may be sent again.
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        using var renewalStop = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token);
        var renewal = RenewAsync(job, renewalStop.Token);
        var sent = false;
        try
        {
            await mail.SendAsync(job.Recipient, job.Title, job.Body, timeout.Token);
            sent = true;
        }
        catch (Exception)
        {
            logger.LogWarning("Email attempt {Attempt} failed for {JobId}", job.Attempts, job.Id);
        }
        finally
        {
            await renewalStop.CancelAsync();
        }
        if (!await renewal)
            return;
        using var finish = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BackendDbContext>();
        await using var tx = await db.Database.BeginTransactionAsync(finish.Token);
        var now = DateTimeOffset.UtcNow;
        var terminal = sent || job.Attempts >= options.Value.MaxAttempts;
        var status = terminal
            ? sent
                ? "SENT"
                : "FAILED"
            : "PENDING";
        var available = now.AddSeconds(
            RetrySeconds[Math.Clamp(job.Attempts - 1, 0, RetrySeconds.Length - 1)]
        );
        var changed = await db
            .EmailJobs.Where(x =>
                x.Id == job.Id
                && x.Status == "PROCESSING"
                && x.LeaseId == job.LeaseId
                && x.LeaseUntil > now
            )
            .ExecuteUpdateAsync(
                u =>
                    u.SetProperty(x => x.Status, status)
                        .SetProperty(x => x.LeaseId, (Guid?)null)
                        .SetProperty(x => x.LeaseUntil, (DateTimeOffset?)null)
                        .SetProperty(x => x.AvailableAt, available)
                        .SetProperty(x => x.CompletedAt, terminal ? now : (DateTimeOffset?)null),
                finish.Token
            );
        if (changed == 1 && terminal)
            await db
                .Notifications.Where(x => x.Id == job.NotificationId)
                .ExecuteUpdateAsync(u => u.SetProperty(x => x.EmailStatus, status), finish.Token);
        await tx.CommitAsync(finish.Token);
        if (changed == 1)
            BackendTelemetry.Email.Add(
                1,
                new KeyValuePair<string, object?>("outcome", terminal ? status : "RETRY")
            );
    }
}
