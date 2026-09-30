using Amazon.S3.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Persistence;
using ModularBackend.Infrastructure.Storage;
var apply = args.Contains("--apply"); if (args.Any(a => a != "--apply")) throw new ArgumentException("Only --apply supported");
var configuration = new ConfigurationBuilder().AddEnvironmentVariables().Build();
var options = configuration.GetSection("Upload").Get<UploadOptions>() ?? new();
await using var db = new BackendDesignFactory().CreateDbContext([]);
using var storage = new ObjectStorage(Options.Create(options));
using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(5)); var ct = timeout.Token;
var cutoff = DateTimeOffset.UtcNow.AddHours(-options.OrphanGraceHours);
async Task Candidate(string key, DateTimeOffset modified)
{
    if (modified >= cutoff || !Guid.TryParseExact(key, "D", out _)) return;
    if (await db.StoredFiles.AnyAsync(f => f.ObjectKey == key, ct)) return;
    Console.WriteLine((apply ? "REMOVE " : "DRY RUN ") + key);
    if (apply && !await db.StoredFiles.AnyAsync(f => f.ObjectKey == key, ct)) await storage.RemoveAsync(new StoredObject(options.Storage, key), ct);
}
if (options.Storage == "local")
{
    var root = Path.GetFullPath(options.LocalRoot);
    if (Directory.Exists(root)) foreach (var path in Directory.EnumerateFiles(root)) { var key = Path.GetFileName(path); if (!Guid.TryParseExact(key, "D", out _)) continue; _ = storage.LocalPath(key); await Candidate(key, File.GetLastWriteTimeUtc(path)); }
}
else
{
    string? cursor = null; do { var response = await storage.S3.ListObjectsV2Async(new ListObjectsV2Request { BucketName = options.Bucket, ContinuationToken = cursor }, ct); foreach (var item in response.S3Objects ?? []) if (item.LastModified is { } instant) await Candidate(item.Key, instant); cursor = response.IsTruncated == true ? response.NextContinuationToken : null; } while (cursor is not null);
}
