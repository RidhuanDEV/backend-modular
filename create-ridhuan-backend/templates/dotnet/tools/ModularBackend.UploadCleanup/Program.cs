using System.ComponentModel.DataAnnotations;
using Amazon.S3.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Jobs;
using ModularBackend.Infrastructure.Observability;
using ModularBackend.Infrastructure.Persistence;
using ModularBackend.Infrastructure.Storage;
var apply = args.Contains("--apply"); if (args.Any(a => a is not ("--apply" or "--dry-run")) || apply && args.Contains("--dry-run")) throw new ArgumentException("Use --apply or --dry-run");
var configuration = new ConfigurationBuilder().AddEnvironmentVariables().Build();
var options = configuration.GetSection("Upload").Get<UploadOptions>() ?? new();
var cleanup = configuration.GetSection("Cleanup").Get<CleanupOptions>() ?? new();
Validator.ValidateObject(cleanup, new ValidationContext(cleanup), true);
Validator.ValidateObject(options, new ValidationContext(options), true);
if (cleanup.AuditEnabled && configuration["Cleanup:AuditDays"] is null) throw new InvalidOperationException("Audit cleanup requires explicit Cleanup:AuditDays");
var builder = Host.CreateApplicationBuilder(); builder.Logging.AddBackendJsonLogs(); builder.Services.AddBackendTelemetry(configuration);
using var host = builder.Build(); await host.StartAsync();
await using var db = DatabaseProvider.Create(configuration["Database:Provider"] ?? "postgresql", configuration["Database:ConnectionString"] ?? throw new InvalidOperationException("Database connection required"));
using var storage = new ObjectStorage(Options.Create(options));
using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(5)); var ct = timeout.Token;
var cutoff = DateTimeOffset.UtcNow.AddHours(-options.OrphanGraceHours);
await Retention.CleanupAsync(db, cleanup, apply, ct);
var candidates = 0; var deleted = 0;
async Task Candidate(string key, DateTimeOffset modified)
{
    if (candidates >= cleanup.BatchSize || modified >= cutoff || !Guid.TryParseExact(key, "D", out _)) return;
    if (await db.StoredFiles.AnyAsync(f => f.ObjectKey == key, ct)) return;
    Console.WriteLine((apply ? "REMOVE " : "DRY RUN ") + key);
    candidates++;
    if (apply && !await db.StoredFiles.AnyAsync(f => f.ObjectKey == key, ct)) { await storage.RemoveAsync(new StoredObject(options.Storage, key), ct); deleted++; }
}
if (options.Storage == "local")
{
    var root = Path.GetFullPath(options.LocalRoot);
    if (Directory.Exists(root)) foreach (var path in Directory.EnumerateFiles(root)) { if (candidates >= cleanup.BatchSize) break; var key = Path.GetFileName(path); if (!Guid.TryParseExact(key, "D", out _)) continue; _ = storage.LocalPath(key); await Candidate(key, File.GetLastWriteTimeUtc(path)); }
}
else
{
    string? cursor = null; do { var response = await storage.S3.ListObjectsV2Async(new ListObjectsV2Request { BucketName = options.Bucket, ContinuationToken = cursor }, ct); foreach (var item in response.S3Objects ?? []) { if (candidates >= cleanup.BatchSize) break; if (item.LastModified is { } instant) await Candidate(item.Key, instant); } cursor = response.IsTruncated == true ? response.NextContinuationToken : null; } while (cursor is not null && candidates < cleanup.BatchSize);
}
BackendTelemetry.Cleanup.Add(apply ? deleted : candidates, new KeyValuePair<string, object?>("kind", "upload"), new KeyValuePair<string, object?>("apply", apply));
await host.StopAsync();
