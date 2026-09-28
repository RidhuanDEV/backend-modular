using ModularBackend.Domain;

namespace ModularBackend.Application;

public sealed class UploadService(BackendService backend, IObjectStorage storage, TimeProvider clock, IAuditFailureReporter failures)
{
    public static bool ValidSignature(ReadOnlySpan<byte> bytes, string mime) => mime switch
    {
        "image/png" => bytes.StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
        "image/jpeg" => bytes.StartsWith(new byte[] { 255, 216, 255 }),
        "application/pdf" => bytes.StartsWith("%PDF-"u8),
        _ => false
    };
    public async Task<FileResult> CreateAsync(Stream input, string originalName, string mime, long maxBytes, IReadOnlyList<string> allowedMime, OperationContext ctx, CancellationToken ct)
    {
        if (!allowedMime.Contains(mime)) throw new ApiException(400, "Unsupported file type");
        using var buffer = new MemoryStream();
        var bytes = new byte[81920];
        int read;
        while ((read = await input.ReadAsync(bytes, ct)) > 0)
        {
            if (buffer.Length + read > maxBytes) throw new ApiException(413, "File too large");
            await buffer.WriteAsync(bytes.AsMemory(0, read), ct);
        }
        if (!ValidSignature(buffer.GetBuffer().AsSpan(0, (int)Math.Min(buffer.Length, 8)), mime)) throw new ApiException(400, "Unsupported file type");
        buffer.Position = 0;
        var stored = await storage.PutAsync(buffer, mime, ct);
        try
        {
            var name = originalName.Replace('\\', '/').Split('/').Last();
            if (name.Length > 255) name = name[..255];
            return await backend.SaveFileAsync(new StoredFile { Storage = stored.Storage, ObjectKey = stored.Key, OriginalName = name, MimeType = mime, Size = buffer.Length, UploaderId = ctx.Actor?.Id, CreatedAt = clock.GetUtcNow() }, ctx, ct);
        }
        catch
        {
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try { if (!await backend.IsFileReferencedAsync(stored.Key, cleanup.Token)) await storage.RemoveAsync(stored, cleanup.Token); }
            catch (Exception ex) { failures.Report(ex, "upload.compensation:" + stored.Key); }
            throw;
        }
    }
}
