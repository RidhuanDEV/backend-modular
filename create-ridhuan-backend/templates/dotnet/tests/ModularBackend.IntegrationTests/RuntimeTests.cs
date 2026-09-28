using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ModularBackend.Api.Middleware;
using ModularBackend.Application;
using ModularBackend.Domain;
using ModularBackend.Infrastructure.Caching;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Persistence;
using ModularBackend.Infrastructure.Security;
using ModularBackend.Infrastructure.Storage;
using ModularBackend.Tests;
using Npgsql;
using Role = ModularBackend.Domain.Role;

namespace ModularBackend.IntegrationTests;

[TestClass]
public sealed class RuntimeTests
{
    private string database = "";
    private string uploadRoot = "";
    private string connectionString = "";
    private string controlConnection = "";
    private Guid adminId;
    private Guid userRoleId;
    private TestHost host = null!;
    private HttpClient client = null!;
    private BackendDbContext Db() => new(new DbContextOptionsBuilder<BackendDbContext>().UseNpgsql(connectionString).Options);
    [TestInitialize]
    public async Task Initialize()
    {
        var configured = Environment.GetEnvironmentVariable("Database__ConnectionString");
        if (string.IsNullOrEmpty(configured)) Assert.Inconclusive("Real PostgreSQL required: Database__ConnectionString");
        database = "modular_net_test_" + Guid.NewGuid().ToString("N");
        uploadRoot = Path.Combine(Path.GetTempPath(), database);
        var control = new NpgsqlConnectionStringBuilder(configured) { Database = "postgres", Pooling = false };
        controlConnection = control.ConnectionString;
        await using (var connection = new NpgsqlConnection(controlConnection))
        {
            await connection.OpenAsync(); await using var command = new NpgsqlCommand($"CREATE DATABASE {database}", connection); await command.ExecuteNonQueryAsync();
        }
        var test = new NpgsqlConnectionStringBuilder(configured) { Database = database, Pooling = false }; connectionString = test.ConnectionString;
        await using var db = Db(); await db.Database.MigrateAsync();
        var now = TimeProvider.System.GetUtcNow();
        var adminRole = new Role { Name = "admin", CreatedAt = now, UpdatedAt = now }; var userRole = new Role { Name = "user", CreatedAt = now, UpdatedAt = now };
        foreach (var name in new[] { "manage_users", "manage_roles", "manage_permissions" })
        { var p = new Permission { Name = name, CreatedAt = now, UpdatedAt = now }; adminRole.Permissions.Add(new() { Role = adminRole, RoleId = adminRole.Id, Permission = p, PermissionId = p.Id }); }
        var admin = new User { Email = "admin@example.test", PasswordHash = "", Role = adminRole, RoleId = adminRole.Id, CreatedAt = now, UpdatedAt = now }; admin.PasswordHash = new PasswordService().Hash(admin, "fixture-password");
        db.Roles.AddRange(adminRole, userRole); db.Users.Add(admin); await db.SaveChangesAsync(); adminId = admin.Id; userRoleId = userRole.Id;
        host = new TestHost(new Dictionary<string, string?> { ["Database:ConnectionString"] = connectionString, ["Upload:LocalRoot"] = uploadRoot }); client = host.CreateClient();
        var login = await Send(HttpMethod.Post, "/api/auth/login", new { email = admin.Email, password = "fixture-password" }, HttpStatusCode.OK);
        client.DefaultRequestHeaders.Authorization = new("Bearer", login.GetProperty("data").GetProperty("accessToken").GetString());
    }
    [TestCleanup]
    public async Task Cleanup()
    {
        client?.Dispose(); if (host is not null) await host.DisposeAsync();
        if (database.Length == 0 || controlConnection.Length == 0) return;
        await using var connection = new NpgsqlConnection(controlConnection); await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"DROP DATABASE IF EXISTS {database} WITH (FORCE)", connection); await command.ExecuteNonQueryAsync();
    }
    private async Task<JsonElement> Send<T>(HttpMethod method, string path, T body, HttpStatusCode expected)
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) }; using var response = await client.SendAsync(request); var raw = await response.Content.ReadAsStringAsync();
        Assert.AreEqual(expected, response.StatusCode, path + ": " + raw);
        if (expected == HttpStatusCode.NoContent) { Assert.AreEqual("", raw); return default; }
        using var json = JsonDocument.Parse(raw); Assert.AreEqual((int)expected < 400, json.RootElement.GetProperty("success").GetBoolean()); return json.RootElement.Clone();
    }
    private async Task<JsonElement> Get(string path)
    {
        using var response = await client.GetAsync(path); var raw = await response.Content.ReadAsStringAsync(); Assert.AreEqual(HttpStatusCode.OK, response.StatusCode, raw); using var json = JsonDocument.Parse(raw); return json.RootElement.Clone();
    }
    [TestMethod]
    public async Task CrudAuthRbacAuditAndLocalUploadRoundTrip()
    {
        foreach (var path in new[] { "/health", "/live", "/ready", "/api/auth/me", "/api/users", "/api/roles", "/api/permissions" }) await Get(path);
        var registration = await Send(HttpMethod.Post, "/api/auth/register", new { email = "new@example.test", password = "fixture-password" }, HttpStatusCode.Created);
        Assert.IsFalse(registration.GetProperty("data").TryGetProperty("deletedAt", out _));
        var user = await Send(HttpMethod.Post, "/api/users", new { email = "crud@example.test", password = "fixture-password", roleId = userRoleId }, HttpStatusCode.Created); var userId = user.GetProperty("data").GetProperty("id").GetGuid();
        await Get("/api/users/" + userId); await Send(HttpMethod.Patch, "/api/users/" + userId, new { email = "updated@example.test" }, HttpStatusCode.OK);
        var page = await Get("/api/users?page=1&limit=1&search=updated&sortBy=email&orderBy=desc"); Assert.AreEqual(1, page.GetProperty("meta").GetProperty("totalItems").GetInt32());
        var projection = await Get("/api/users?fields=id,email,password"); var projected = projection.GetProperty("data")[0]; Assert.IsTrue(projected.TryGetProperty("email", out _)); Assert.IsFalse(projected.TryGetProperty("role", out _)); Assert.IsFalse(projected.TryGetProperty("password", out _));
        var role = await Send(HttpMethod.Post, "/api/roles", new { name = "staff" }, HttpStatusCode.Created); var roleId = role.GetProperty("data").GetProperty("id").GetGuid();
        await Get("/api/roles/" + roleId); await Send(HttpMethod.Patch, "/api/roles/" + roleId, new { name = "staff-updated" }, HttpStatusCode.OK);
        var permission = await Send(HttpMethod.Post, "/api/permissions", new { name = "custom_permission" }, HttpStatusCode.Created); var permissionId = permission.GetProperty("data").GetProperty("id").GetGuid();
        await Get("/api/permissions/" + permissionId); await Send(HttpMethod.Patch, "/api/permissions/" + permissionId, new { name = "custom_permission_updated" }, HttpStatusCode.OK);
        await Send(HttpMethod.Post, "/api/roles/" + roleId + "/permissions", new { permissionIds = new[] { permissionId } }, HttpStatusCode.OK);
        using var multipart = new MultipartFormDataContent(); using var bytes = new ByteArrayContent("%PDF-fixture"u8.ToArray()); bytes.Headers.ContentType = new("application/pdf"); multipart.Add(bytes, "file", "../../fixture.pdf");
        using var uploaded = await client.PostAsync("/api/upload", multipart); var uploadRaw = await uploaded.Content.ReadAsStringAsync(); Assert.AreEqual(HttpStatusCode.Created, uploaded.StatusCode, uploadRaw);
        using var uploadJson = JsonDocument.Parse(uploadRaw); var fileId = uploadJson.RootElement.GetProperty("data").GetProperty("id").GetGuid(); await Get("/api/upload/" + fileId); Assert.AreEqual("fixture.pdf", uploadJson.RootElement.GetProperty("data").GetProperty("originalName").GetString());
        await Send(HttpMethod.Delete, "/api/users/" + userId, new { }, HttpStatusCode.NoContent); await Send(HttpMethod.Delete, "/api/roles/" + roleId, new { }, HttpStatusCode.NoContent); await Send(HttpMethod.Delete, "/api/permissions/" + permissionId, new { }, HttpStatusCode.NoContent);
        await using var db = Db(); var audits = await db.ActivityLogs.AsNoTracking().ToArrayAsync(); Assert.IsGreaterThan(8, audits.Length);
        foreach (var audit in audits) { Assert.IsFalse((audit.Before + audit.After).Contains("fixture-password", StringComparison.Ordinal)); Assert.IsFalse((audit.Before + audit.After).Contains("PasswordHash", StringComparison.OrdinalIgnoreCase)); Assert.AreEqual(TimeSpan.Zero, audit.CreatedAt.Offset); }
        Assert.IsFalse(db.Database.HasPendingModelChanges()); Assert.IsNotNull(await db.Users.IgnoreQueryFilters().Where(u => u.Id == userId).Select(u => u.DeletedAt).SingleAsync());
        await Send(HttpMethod.Post, "/api/auth/login", new { email = "updated@example.test", password = "fixture-password" }, HttpStatusCode.Unauthorized);
        var token = await Send(HttpMethod.Post, "/api/auth/login", new { email = "new@example.test", password = "fixture-password" }, HttpStatusCode.OK); using var ordinary = host.CreateClient(); ordinary.DefaultRequestHeaders.Authorization = new("Bearer", token.GetProperty("data").GetProperty("accessToken").GetString()); using var forbidden = await ordinary.GetAsync("/api/users"); Assert.AreEqual(HttpStatusCode.Forbidden, forbidden.StatusCode);
        await Send(HttpMethod.Delete, "/api/users/" + adminId, new { }, HttpStatusCode.Forbidden);
    }
    [TestMethod]
    public async Task RequiredAuditFailureRollsBackAndOptionalFailureCommits()
    {
        await using var db = Db();
        await db.Database.ExecuteSqlRawAsync("CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_audit();");
        await Send(HttpMethod.Post, "/api/roles", new { name = "must_rollback" }, HttpStatusCode.InternalServerError);
        Assert.IsFalse(await db.Roles.AnyAsync(r => r.Name == "must_rollback"));
        await using var optionalHost = new TestHost(new Dictionary<string, string?> { ["Database:ConnectionString"] = connectionString, ["ENDPOINT_POLICIES_JSON"] = "{\"role.create\":{\"audit\":\"optional\"}}" });
        using var optional = optionalHost.CreateClient(); optional.DefaultRequestHeaders.Authorization = client.DefaultRequestHeaders.Authorization;
        using var response = await optional.PostAsJsonAsync("/api/roles", new { name = "optional_committed" }); Assert.AreEqual(HttpStatusCode.Created, response.StatusCode); Assert.IsTrue(await db.Roles.AnyAsync(r => r.Name == "optional_committed"));
    }
    [TestMethod]
    public async Task DeletedGrantsInvalidateExistingJwtImmediately()
    {
        await using var db = Db(); var grant = await db.RolePermissions.Include(g => g.Permission).FirstAsync(g => g.Permission.Name == "manage_users"); db.RolePermissions.Remove(grant); await db.SaveChangesAsync();
        using var response = await client.GetAsync("/api/users"); Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }
    [TestMethod]
    public async Task ConcurrencyTokenRejectsLostUpdate()
    {
        await using var first = Db(); await using var second = Db(); var a = await first.Roles.SingleAsync(r => r.Name == "user"); var b = await second.Roles.SingleAsync(r => r.Name == "user"); a.Name = "first"; await first.SaveChangesAsync(); b.Name = "second"; await Assert.ThrowsExactlyAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync());
    }
    [TestMethod]
    public async Task RedisTwoInstanceLimitExpiryAndFailureModes()
    {
        var address = Environment.GetEnvironmentVariable("Redis__ConnectionString"); if (string.IsNullOrWhiteSpace(address)) Assert.Inconclusive("Real Redis required");
        var options = Options.Create(new RateOptions { Store = "redis", InstanceCount = 2, Auth = new() { Max = 2, WindowMs = 250 } });
        using var redisA = new RedisConnection(Options.Create(new RedisOptions { ConnectionString = address })); using var redisB = new RedisConnection(Options.Create(new RedisOptions { ConnectionString = address }));
        using var a = new EndpointLimiter(options, redisA, NullLogger<EndpointLimiter>.Instance); using var b = new EndpointLimiter(options, redisB, NullLogger<EndpointLimiter>.Instance); var identity = Guid.NewGuid().ToString();
        var results = await Task.WhenAll(a.CheckAsync(RateLimitGroup.Auth, identity, default), b.CheckAsync(RateLimitGroup.Auth, identity, default), a.CheckAsync(RateLimitGroup.Auth, identity, default)); Assert.AreEqual(2, results.Count(r => r == 200)); Assert.AreEqual(1, results.Count(r => r == 429));
        await Task.Delay(300); Assert.AreEqual(200, await b.CheckAsync(RateLimitGroup.Auth, identity, default));
        using var unavailable = new RedisConnection(Options.Create(new RedisOptions { ConnectionString = "localhost:1" })); using var down = new EndpointLimiter(options, unavailable, NullLogger<EndpointLimiter>.Instance);
        Assert.AreEqual(503, await down.CheckAsync(RateLimitGroup.Auth, identity, default)); Assert.AreEqual(200, await down.CheckAsync(RateLimitGroup.Public, identity, default)); Assert.AreEqual(200, await down.CheckAsync(RateLimitGroup.Internal, identity, default));
    }
    [TestMethod]
    public async Task CacheCorruptDownAndDurableCrossInstanceInvalidation()
    {
        var address = Environment.GetEnvironmentVariable("Redis__ConnectionString"); if (string.IsNullOrWhiteSpace(address)) Assert.Inconclusive("Real Redis required");
        using var redis = new RedisConnection(Options.Create(new RedisOptions { ConnectionString = address })); await using var db = Db();
        var prefix = "integration:" + Guid.NewGuid(); var options = Options.Create(new CacheOptions { Enabled = true, Prefix = prefix }); var cache = new ResponseCache(redis, db, options, NullLogger<ResponseCache>.Instance); var calls = 0;
        Task<StatusResult> Load(CancellationToken _) { calls++; return Task.FromResult(new StatusResult("ok")); }
        await cache.ReadAsync("test", true, Load, r => r.Status == "ok", default); await cache.ReadAsync("test", true, Load, r => r.Status == "ok", default); Assert.AreEqual(1, calls);
        await redis.Database.StringSetAsync(prefix + ":0:test", "corrupt"); await cache.ReadAsync("test", true, Load, r => r.Status == "ok", default); Assert.AreEqual(2, calls);
        await Send(HttpMethod.Post, "/api/roles", new { name = "invalidate" }, HttpStatusCode.Created); await cache.ReadAsync("test", true, Load, r => r.Status == "ok", default); Assert.AreEqual(3, calls);
        using var bad = new RedisConnection(Options.Create(new RedisOptions { ConnectionString = "localhost:1" })); var fallback = new ResponseCache(bad, db, options, NullLogger<ResponseCache>.Instance); await fallback.ReadAsync("test", true, Load, r => r.Status == "ok", default); Assert.AreEqual(4, calls);
    }
    [TestMethod]
    public async Task S3OfficialSdkRoundTrip()
    {
        var endpoint = Environment.GetEnvironmentVariable("Upload__Endpoint"); if (string.IsNullOrWhiteSpace(endpoint)) Assert.Inconclusive("Real S3 required");
        var options = new UploadOptions { Storage = "s3", Endpoint = endpoint, Bucket = Environment.GetEnvironmentVariable("Upload__Bucket") ?? "uploads", AccessKey = Environment.GetEnvironmentVariable("Upload__AccessKey") ?? "", SecretKey = Environment.GetEnvironmentVariable("Upload__SecretKey") ?? "" };
        using var storage = new ObjectStorage(Options.Create(options)); using var stream = new MemoryStream("%PDF-sdk-fixture"u8.ToArray()); var stored = await storage.PutAsync(stream, "application/pdf", default);
        try { using var response = await storage.S3.GetObjectAsync(options.Bucket, stored.Key); using var reader = new StreamReader(response.ResponseStream, Encoding.UTF8); Assert.AreEqual("%PDF-sdk-fixture", await reader.ReadToEndAsync()); } finally { await storage.RemoveAsync(stored, default); }
    }
    [TestMethod]
    public async Task CorsAndReadinessOutageBoundaries()
    {
        using var allowed = new HttpRequestMessage(HttpMethod.Get, "/live"); allowed.Headers.Add("Origin", "http://localhost:5173"); using var accepted = await client.SendAsync(allowed); Assert.IsTrue(accepted.Headers.Contains("Access-Control-Allow-Origin"));
        using var denied = new HttpRequestMessage(HttpMethod.Get, "/live"); denied.Headers.Add("Origin", "https://untrusted.example"); using var deniedResponse = await client.SendAsync(denied); Assert.IsFalse(deniedResponse.Headers.Contains("Access-Control-Allow-Origin"));
        await using var downHost = new TestHost(new Dictionary<string, string?> { ["Database:ConnectionString"] = "Host=localhost;Port=1;Database=down;Username=test;Password=test;Timeout=1", ["Cache:Enabled"] = "true", ["Redis:ConnectionString"] = "localhost:1" }); using var down = downHost.CreateClient();
        using var live = await down.GetAsync("/live"); Assert.AreEqual(HttpStatusCode.OK, live.StatusCode); using var ready = await down.GetAsync("/ready"); Assert.AreEqual(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
    }

    [TestMethod]
    public async Task UpgradePreservesExistingDataAndSeedNeverResetsPassword()
    {
        await using var db = Db();
        var first = db.Database.GetMigrations().First();
        await db.GetService<IMigrator>().MigrateAsync(first);
        var before = await db.Users.Where(u => u.Id == adminId).Select(u => u.PasswordHash).SingleAsync();
        await db.Database.MigrateAsync();
        Assert.IsFalse(db.Database.HasPendingModelChanges());
        Assert.AreEqual(before, await db.Users.Where(u => u.Id == adminId).Select(u => u.PasswordHash).SingleAsync());
        await RunTool("Seeder", []);
        await RunTool("Seeder", []);
        Assert.AreEqual(before, await db.Users.Where(u => u.Id == adminId).Select(u => u.PasswordHash).SingleAsync());
        Assert.AreEqual(2, await db.Roles.CountAsync());
    }
    private async Task<string> RunTool(string tool, string[] arguments)
    {
        var repository = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
        var executable = Environment.GetEnvironmentVariable("DOTNET_ROOT") is { } sdk ? Path.Combine(sdk, OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet") : "dotnet";
        var processInfo = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        processInfo.ArgumentList.Add(Path.Combine(repository, "tools", "ModularBackend." + tool, "bin", "Release", "net10.0", "ModularBackend." + tool + ".dll"));
        foreach (var argument in arguments) processInfo.ArgumentList.Add(argument);
        processInfo.Environment["Database__ConnectionString"] = connectionString;
        processInfo.Environment["Upload__Storage"] = "local";
        processInfo.Environment["Upload__LocalRoot"] = uploadRoot;
        processInfo.Environment["Bootstrap__Email"] = "admin@example.test";
        processInfo.Environment["Bootstrap__Password"] = "different-fixture-password";
        using var process = Process.Start(processInfo) ?? throw new InvalidOperationException("Tool failed to start");
        var output = process.StandardOutput.ReadToEndAsync(); var error = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30)); await process.WaitForExitAsync(timeout.Token);
        var text = await output; Assert.AreEqual(0, process.ExitCode, await error); return text;
    }
    [TestMethod]
    public async Task UploadCompensationAndOrphanToolDryRunApply()
    {
        await using var db = Db();
        await db.Database.ExecuteSqlRawAsync("CREATE FUNCTION reject_upload_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_upload_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_upload_audit();");
        using var upload = new MultipartFormDataContent(); var bytes = new ByteArrayContent("%PDF-compensation"u8.ToArray()); bytes.Headers.ContentType = new("application/pdf"); upload.Add(bytes, "file", "test.pdf");
        using var result = await client.PostAsync("/api/upload", upload); Assert.AreEqual(HttpStatusCode.InternalServerError, result.StatusCode);
        Assert.IsFalse(await db.StoredFiles.AnyAsync()); Assert.IsFalse(Directory.Exists(uploadRoot) && Directory.EnumerateFiles(uploadRoot).Any());
        using var actual = new ObjectStorage(Options.Create(new UploadOptions { LocalRoot = uploadRoot }));
        var failing = new FailingDeleteStorage(actual);
        await using var failedCleanup = new TestHost(new Dictionary<string, string?> { ["Database:ConnectionString"] = connectionString, ["Upload:LocalRoot"] = uploadRoot }).WithWebHostBuilder(b => b.ConfigureServices(services => services.AddSingleton<IObjectStorage>(failing)));
        using var failClient = failedCleanup.CreateClient(); failClient.DefaultRequestHeaders.Authorization = client.DefaultRequestHeaders.Authorization;
        using var another = new MultipartFormDataContent(); var moreBytes = new ByteArrayContent("%PDF-orphan"u8.ToArray()); moreBytes.Headers.ContentType = new("application/pdf"); another.Add(moreBytes, "file", "orphan.pdf");
        using var failed = await failClient.PostAsync("/api/upload", another); Assert.AreEqual(HttpStatusCode.InternalServerError, failed.StatusCode);
        Assert.IsNotNull(failing.Stored); var orphan = actual.LocalPath(failing.Stored.Key); Assert.IsTrue(File.Exists(orphan));
        File.SetLastWriteTimeUtc(orphan, DateTime.UtcNow.AddDays(-2));
        var dryRun = await RunTool("UploadCleanup", []); Assert.IsTrue(dryRun.Contains("DRY RUN", StringComparison.Ordinal)); Assert.IsTrue(File.Exists(orphan));
        await RunTool("UploadCleanup", ["--apply"]); Assert.IsFalse(File.Exists(orphan));
    }
    private sealed class FailingDeleteStorage(IObjectStorage actual) : IObjectStorage
    {
        public StoredObject? Stored { get; private set; }
        public async Task<StoredObject> PutAsync(Stream stream, string mime, CancellationToken ct) { Stored = await actual.PutAsync(stream, mime, ct); return Stored; }
        public Task RemoveAsync(StoredObject stored, CancellationToken ct) => throw new IOException("Fixture deletion failure");
    }
    [TestMethod]
    public async Task UploadOversizeAndInvalidSignatureUseExpectedStatuses()
    {
        await using var limitedHost = new TestHost(new Dictionary<string, string?> { ["Database:ConnectionString"] = connectionString, ["Upload:LocalRoot"] = uploadRoot, ["Upload:MaxBytes"] = "64" });
        using var limited = limitedHost.CreateClient(); limited.DefaultRequestHeaders.Authorization = client.DefaultRequestHeaders.Authorization;
        foreach (var oversized in new[] { false, true })
        {
            using var body = new MultipartFormDataContent(); var bytes = new ByteArrayContent(oversized ? new byte[100] : "forged-png"u8.ToArray()); bytes.Headers.ContentType = new("image/png"); body.Add(bytes, "file", "image.png"); using var response = await limited.PostAsync("/api/upload", body);
            Assert.AreEqual(oversized ? HttpStatusCode.RequestEntityTooLarge : HttpStatusCode.BadRequest, response.StatusCode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()); Assert.IsFalse(json.RootElement.GetProperty("success").GetBoolean());
        }
    }

    [TestMethod]
    public async Task JwtRejectsWrongIssuerAudienceSignatureExpiryAndAlgorithm()
    {
        var now = DateTime.UtcNow;
        foreach (var mode in new[] { "issuer", "audience", "signature", "expiry", "algorithm" })
        {
            var secret = new string(mode == "signature" ? 'w' : 't', 64);
            var signing = new Microsoft.IdentityModel.Tokens.SigningCredentials(new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)), mode == "algorithm" ? Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha384 : Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256);
            var jwt = new System.IdentityModel.Tokens.Jwt.JwtSecurityToken(mode == "issuer" ? "wrong" : "modular-net", mode == "audience" ? "wrong" : "modular-net-clients", [new System.Security.Claims.Claim("sub", adminId.ToString()), new System.Security.Claims.Claim("roleId", userRoleId.ToString())], mode == "expiry" ? now.AddHours(-2) : now.AddMinutes(-1), mode == "expiry" ? now.AddHours(-1) : now.AddHours(1), signing);
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/users"); request.Headers.Authorization = new("Bearer", new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().WriteToken(jwt));
            using var response = await client.SendAsync(request); Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode, mode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()); Assert.IsFalse(json.RootElement.GetProperty("success").GetBoolean());
        }
    }
    [TestMethod]
    public async Task CacheOnlyRedisOutageKeepsReadinessAndPatchNullIsRejected()
    {
        await using var cacheOnly = new TestHost(new Dictionary<string, string?> { ["Database:ConnectionString"] = connectionString, ["Cache:Enabled"] = "true", ["Redis:ConnectionString"] = "127.0.0.1:1", ["Rate:Store"] = "memory" });
        using var probe = cacheOnly.CreateClient(); using var ready = await probe.GetAsync("/ready"); Assert.AreEqual(HttpStatusCode.OK, ready.StatusCode);
        using var patch = await client.PatchAsJsonAsync("/api/users/" + adminId, new { email = (string?)null }); Assert.AreEqual(HttpStatusCode.BadRequest, patch.StatusCode);
        using var empty = await client.PatchAsJsonAsync("/api/users/" + adminId, new { }); Assert.AreEqual(HttpStatusCode.OK, empty.StatusCode);
    }
}
