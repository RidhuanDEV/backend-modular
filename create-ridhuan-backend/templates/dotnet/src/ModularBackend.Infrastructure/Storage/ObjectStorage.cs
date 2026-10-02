using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Observability;

namespace ModularBackend.Infrastructure.Storage;

public sealed class ObjectStorage(IOptions<UploadOptions> options, ILogger<ObjectStorage>? logger = null) : IObjectStorage, IDisposable
{
    private AmazonS3Client? client;
    public IAmazonS3 S3 => client ??= CreateClient();
    private AmazonS3Client CreateClient()
    {
        var config = new AmazonS3Config { ForcePathStyle = options.Value.ForcePathStyle, AuthenticationRegion = options.Value.Region, Timeout = TimeSpan.FromSeconds(15), MaxErrorRetry = 0 };
        if (!string.IsNullOrEmpty(options.Value.Endpoint)) config.ServiceURL = options.Value.Endpoint;
        else config.RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(options.Value.Region);
        return string.IsNullOrEmpty(options.Value.AccessKey) ? new AmazonS3Client(config) : new AmazonS3Client(new BasicAWSCredentials(options.Value.AccessKey, options.Value.SecretKey), config);
    }
    public string LocalPath(string key)
    {
        if (!Guid.TryParseExact(key, "D", out _)) throw new InvalidOperationException("Invalid object key");
        var root = Path.GetFullPath(options.Value.LocalRoot);
        Directory.CreateDirectory(root);
        for (DirectoryInfo? current = new(root); current is not null; current = current.Parent)
            if ((current.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Storage root must not use symlinks");
        var path = Path.Combine(root, key);
        if (File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Object must not use symlinks");
        return path;
    }
    public async Task<StoredObject> PutAsync(Stream stream, string mime, CancellationToken ct)
    {
        using var activity = BackendTelemetry.Storage.StartActivity("storage.put");
        activity?.SetTag("storage.system", options.Value.Storage);
        var key = Guid.NewGuid().ToString("D");
        if (options.Value.Storage == "s3")
        {
            try { await S3.PutObjectAsync(new PutObjectRequest { BucketName = options.Value.Bucket, Key = key, InputStream = stream, ContentType = mime, AutoCloseStream = false }, ct); }
            catch
            {
                using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                try { await S3.DeleteObjectAsync(options.Value.Bucket, key, cleanup.Token); }
                catch (Exception error) { logger?.LogWarning("S3 write compensation failed; orphan {ObjectKey}, {ErrorType}", key, error.GetType().Name); }
                throw;
            }
        }
        else
        {
            var path = LocalPath(key);
            try { await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous); await stream.CopyToAsync(file, ct); }
            catch { if (File.Exists(path)) File.Delete(path); throw; }
        }
        return new(options.Value.Storage, key);
    }
    public async Task RemoveAsync(StoredObject storedObject, CancellationToken ct)
    {
        using var activity = BackendTelemetry.Storage.StartActivity("storage.delete");
        if (storedObject.Storage == "s3") await S3.DeleteObjectAsync(options.Value.Bucket, storedObject.Key, ct);
        else { ct.ThrowIfCancellationRequested(); File.Delete(LocalPath(storedObject.Key)); }
    }
    public void Dispose() => client?.Dispose();
}
