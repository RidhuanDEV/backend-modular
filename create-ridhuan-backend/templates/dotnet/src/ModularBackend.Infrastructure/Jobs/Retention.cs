using Microsoft.EntityFrameworkCore;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Observability;
using ModularBackend.Infrastructure.Persistence;
using MySql.EntityFrameworkCore.Extensions;

namespace ModularBackend.Infrastructure.Jobs;

public static class Retention
{
    public static async Task CleanupAsync(
        BackendDbContext db,
        CleanupOptions options,
        bool apply,
        CancellationToken ct
    )
    {
        using var activity = BackendTelemetry.Source.StartActivity("cleanup");
        activity?.SetTag("operationId", "operations.cleanup");
        await using var tx = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.ReadCommitted,
            ct
        );
        var now = DateTimeOffset.UtcNow;
        var familyCutoff = now.AddDays(-options.SessionDays);
        var jobCutoff = now.AddDays(-options.OutboxDays);
        var auditCutoff = now.AddDays(-options.AuditDays);
        var families = await (
            db.Database.IsMySql()
                ? db.RefreshFamilies.FromSqlInterpolated(
                    $"SELECT * FROM refresh_families WHERE RevokedAt<{familyCutoff.UtcDateTime} OR (RevokedAt IS NULL AND ExpiresAt<{familyCutoff.UtcDateTime}) ORDER BY Id LIMIT {options.BatchSize} FOR UPDATE SKIP LOCKED"
                )
                : db.RefreshFamilies.FromSqlInterpolated(
                    $"SELECT * FROM refresh_families WHERE \"RevokedAt\"<{familyCutoff} OR (\"RevokedAt\" IS NULL AND \"ExpiresAt\"<{familyCutoff}) ORDER BY \"Id\" LIMIT {options.BatchSize} FOR UPDATE SKIP LOCKED"
                )
        ).ToListAsync(ct);
        var jobs = await (
            db.Database.IsMySql()
                ? db.EmailJobs.FromSqlInterpolated(
                    $"SELECT * FROM email_jobs WHERE Status IN ('SENT','FAILED') AND CompletedAt<{jobCutoff.UtcDateTime} ORDER BY Id LIMIT {options.BatchSize} FOR UPDATE SKIP LOCKED"
                )
                : db.EmailJobs.FromSqlInterpolated(
                    $"SELECT * FROM email_jobs WHERE \"Status\" IN ('SENT','FAILED') AND \"CompletedAt\"<{jobCutoff} ORDER BY \"Id\" LIMIT {options.BatchSize} FOR UPDATE SKIP LOCKED"
                )
        ).ToListAsync(ct);
        var logs = options.AuditEnabled
            ? await (
                db.Database.IsMySql()
                    ? db.ActivityLogs.FromSqlInterpolated(
                        $"SELECT * FROM activity_logs WHERE CreatedAt<{auditCutoff.UtcDateTime} ORDER BY Id LIMIT {options.BatchSize} FOR UPDATE SKIP LOCKED"
                    )
                    : db.ActivityLogs.FromSqlInterpolated(
                        $"SELECT * FROM activity_logs WHERE \"CreatedAt\"<{auditCutoff} ORDER BY \"Id\" LIMIT {options.BatchSize} FOR UPDATE SKIP LOCKED"
                    )
            ).ToListAsync(ct)
            : [];
        if (apply)
        {
            db.RefreshFamilies.RemoveRange(families);
            db.EmailJobs.RemoveRange(jobs);
            db.ActivityLogs.RemoveRange(logs);
            await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct);
        foreach (
            var pair in new[]
            {
                ("family", families.Count),
                ("outbox", jobs.Count),
                ("audit", logs.Count),
            }
        )
            BackendTelemetry.Cleanup.Add(
                pair.Item2,
                new KeyValuePair<string, object?>("kind", pair.Item1),
                new KeyValuePair<string, object?>("apply", apply)
            );
        Console.WriteLine(
            $"apply={apply} families={families.Count} outbox={jobs.Count} audit={logs.Count}"
        );
    }
}
