using System.Security.Claims;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using ModularBackend.Api.Authorization;
using ModularBackend.Api.Endpoints;
using ModularBackend.Api.Middleware;
using ModularBackend.Api.OpenApi;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Caching;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Mail;
using ModularBackend.Infrastructure.Observability;
using ModularBackend.Infrastructure.Persistence;
using ModularBackend.Infrastructure.Security;
using ModularBackend.Infrastructure.Storage;

var builder = WebApplication.CreateBuilder(args);
var isDocumentGeneration =
    System.Reflection.Assembly.GetEntryAssembly()?.GetName().Name == "GetDocument.Insider";
if (isDocumentGeneration)
{
    builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();
    builder.Configuration.AddInMemoryCollection(
        new Dictionary<string, string?>
        {
            ["Database:Provider"] = "postgresql",
            ["Database:ConnectionString"] =
                "Host=127.0.0.1;Port=1;Database=openapi_only;Username=design;Password=design-only",
            ["Jwt:Secret"] = new string('g', 64),
            ["Cache:Enabled"] = "false",
            ["Rate:Store"] = "memory",
            ["Rate:InstanceCount"] = "1",
            ["Telemetry:Enabled"] = "false",
            ["Cors:Origins:0"] = "https://openapi.example",
            ["ENDPOINT_POLICIES_JSON"] = "{}",
        }
    );
}
builder.Logging.AddBackendJsonLogs();
builder
    .Services.AddOptions<DatabaseOptions>()
    .BindConfiguration("Database")
    .ValidateDataAnnotations()
    .Validate(
        o => DatabaseProvider.IsValid(o.Provider, o.ConnectionString),
        "Invalid provider/connection: PostgreSQL ASCII username/database max63; MySQL ASCII username max32/database max64"
    )
    .ValidateOnStart();
builder
    .Services.AddOptions<JwtOptions>()
    .BindConfiguration("Jwt")
    .ValidateDataAnnotations()
    .Validate(
        o =>
            !o.Secret.Contains("CHANGE_ME", StringComparison.OrdinalIgnoreCase)
            && Encoding.UTF8.GetByteCount(o.Secret) >= 32,
        "JWT secret must be generated"
    )
    .ValidateOnStart();
builder
    .Services.AddOptions<RefreshTokenOptions>()
    .BindConfiguration("RefreshToken")
    .ValidateDataAnnotations()
    .Validate(
        o => o.AbsoluteDays >= o.IdleDays,
        "RefreshToken:AbsoluteDays must be at least RefreshToken:IdleDays"
    )
    .ValidateOnStart();
builder
    .Services.AddOptions<CacheOptions>()
    .BindConfiguration("Cache")
    .ValidateDataAnnotations()
    .ValidateOnStart();
builder
    .Services.AddOptions<RedisOptions>()
    .BindConfiguration("Redis")
    .Validate(
        o =>
            !(
                builder.Configuration.GetValue<bool>("Cache:Enabled")
                || builder.Configuration["Rate:Store"] == "redis"
            ) || !string.IsNullOrWhiteSpace(o.ConnectionString),
        "Redis connection string required"
    )
    .ValidateOnStart();
builder
    .Services.AddOptions<RateOptions>()
    .BindConfiguration("Rate")
    .ValidateDataAnnotations()
    .Validate(
        o =>
            o.Store is "memory" or "redis"
            && (o.InstanceCount == 1 || o.Store == "redis")
            && new[] { o.Auth, o.Public, o.Internal }.All(w => w.Max > 0 && w.WindowMs > 0),
        "Invalid rate limiter configuration"
    )
    .ValidateOnStart();

// One check per rule so a misconfigured deployment names the exact setting that failed.
builder
    .Services.AddOptions<UploadOptions>()
    .BindConfiguration("Upload")
    .ValidateDataAnnotations()
    .Validate(o => o.Storage is "local" or "s3", "Upload:Storage must be local or s3")
    .Validate(
        o =>
            o.AllowedMime.Length > 0
            && o.AllowedMime.All(m => m is "image/png" or "image/jpeg" or "application/pdf"),
        "Upload:AllowedMime must list image/png, image/jpeg or application/pdf"
    )
    .Validate(
        o => o.Storage != "s3" || !string.IsNullOrWhiteSpace(o.Bucket),
        "Upload:Bucket is required for s3 storage"
    )
    .Validate(
        o => (o.AccessKey.Length == 0) == (o.SecretKey.Length == 0),
        "Upload:AccessKey and Upload:SecretKey must be set together"
    )
    .Validate(o => !string.IsNullOrWhiteSpace(o.LocalRoot), "Upload:LocalRoot is required")
    .Validate(o => !string.IsNullOrWhiteSpace(o.Region), "Upload:Region is required")
    .Validate(
        o =>
            o.Endpoint.Length == 0
            || Uri.TryCreate(o.Endpoint, UriKind.Absolute, out var endpoint)
                && endpoint.Scheme is "http" or "https",
        "Upload:Endpoint must be an absolute http(s) URL"
    )
    .ValidateOnStart();
builder
    .Services.AddOptions<ModularBackend.Infrastructure.Configuration.CorsOptions>()
    .BindConfiguration("Cors")
    .Validate(
        o =>
            (!builder.Environment.IsProduction() || o.Origins.Length > 0)
            && o.Origins.All(ValidOrigin),
        "Explicit valid CORS origins required in production"
    )
    .ValidateOnStart();
builder
    .Services.AddOptions<TelemetryOptions>()
    .BindConfiguration("Telemetry")
    .Validate(
        o =>
            !o.Enabled
            || Uri.TryCreate(o.Endpoint, UriKind.Absolute, out var url)
                && url.Scheme is "http" or "https",
        "Invalid telemetry endpoint"
    )
    .ValidateOnStart();
builder
    .Services.AddOptions<ProxyOptions>()
    .BindConfiguration("Proxy")
    .Validate(
        o =>
            o.ForwardLimit is > 0 and <= 10
            && o.KnownProxies.All(ip => System.Net.IPAddress.TryParse(ip, out _)),
        "Explicit valid proxy IPs required"
    )
    .ValidateOnStart();
builder
    .Services.AddOptions<WorkerOptions>()
    .BindConfiguration("Worker")
    .ValidateDataAnnotations()
    .Validate(o => o.RenewSeconds * 2 < o.LeaseSeconds, "Invalid worker lease renewal")
    .ValidateOnStart();
builder
    .Services.AddOptions<CleanupOptions>()
    .BindConfiguration("Cleanup")
    .ValidateDataAnnotations()
    .Validate(
        o => !o.AuditEnabled || builder.Configuration["Cleanup:AuditDays"] is not null,
        "Audit cleanup requires explicit Cleanup:AuditDays"
    )
    .ValidateOnStart();
builder
    .Services.AddOptions<SmtpOptions>()
    .BindConfiguration("Smtp")
    .Validate(
        o =>
            !o.Enabled
            || o.Host.Length > 0
                && o.From.Length > 0
                && (o.User.Length == 0) == (o.Password.Length == 0)
                && System.Net.Mail.MailAddress.TryCreate(o.From, out _),
        "Invalid SMTP configuration"
    )
    .ValidateOnStart();
builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(o =>
{
    var proxy = builder.Configuration.GetSection("Proxy").Get<ProxyOptions>() ?? new();
    o.ForwardedHeaders =
        proxy.KnownProxies.Length == 0
            ? Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.None
            : Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor
                | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    o.KnownProxies.Clear();
    o.KnownIPNetworks.Clear();
    foreach (var ip in proxy.KnownProxies)
        o.KnownProxies.Add(System.Net.IPAddress.Parse(ip));
    o.ForwardLimit = proxy.ForwardLimit;
});
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<EndpointRegistry>();
builder.Services.AddSingleton<RedisConnection>();
builder.Services.AddSingleton<EndpointLimiter>();
var databaseProvider = builder.Configuration["Database:Provider"] ?? "postgresql";
if (!isDocumentGeneration)
    DatabaseProvider.ValidateGeneratedProvider(databaseProvider);
if (databaseProvider == "mysql")
{
    builder.Services.AddDbContext<MySqlBackendDbContext>(
        (services, options) =>
            options
                .UseMySQL(
                    services.GetRequiredService<IOptions<DatabaseOptions>>().Value.ConnectionString,
                    mysql => mysql.CommandTimeout(10)
                )
                .AddInterceptors(new MySqlUtcInterceptor(), new DatabaseTelemetryInterceptor())
    );
    builder.Services.AddScoped<BackendDbContext>(services =>
        services.GetRequiredService<MySqlBackendDbContext>()
    );
}
else
    builder.Services.AddDbContext<BackendDbContext>(
        (services, options) =>
            options
                .UseNpgsql(
                    services.GetRequiredService<IOptions<DatabaseOptions>>().Value.ConnectionString,
                    npgsql => npgsql.CommandTimeout(10)
                )
                .AddInterceptors(new DatabaseTelemetryInterceptor())
    );
builder.Services.AddScoped<IBackendStore, BackendStore>();
builder.Services.AddSingleton(services =>
{
    var o = services.GetRequiredService<IOptions<RefreshTokenOptions>>().Value;
    return new RefreshSessionPolicy(o.IdleDays, o.AbsoluteDays);
});
builder.Services.AddScoped<BackendService>();
builder.Services.AddScoped<UploadService>();
builder.Services.AddScoped<INotificationStore, NotificationStore>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddSingleton<INotificationMailSender, SmtpNotificationSender>();
builder.Services.AddSingleton<IPasswordService, PasswordService>();
builder.Services.AddSingleton<ITokenService, TokenService>();
builder.Services.AddSingleton<IAuditFailureReporter, AuditFailureReporter>();
builder.Services.AddSingleton<ObjectStorage>();
builder.Services.AddSingleton<IObjectStorage>(s => s.GetRequiredService<ObjectStorage>());
builder.Services.AddScoped<ResponseCache>();
builder.Services.AddScoped<ICacheInvalidation>(s => s.GetRequiredService<ResponseCache>());
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IAuthorizationHandler, PermissionHandler>();
builder.Services.AddAuthorization(options =>
{
    // One list: route policies and the immutable system permissions must never drift apart.
    foreach (var name in BackendService.SystemPermissions)
        options.AddPolicy(
            name,
            p => p.RequireAuthenticatedUser().AddRequirements(new PermissionRequirement(name))
        );
});
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder
    .Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<IOptions<JwtOptions>>(
        (options, jwt) =>
        {
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = jwt.Value.Issuer,
                ValidateAudience = true,
                ValidAudience = jwt.Value.Audience,
                ValidateLifetime = true,
                RequireExpirationTime = true,
                RequireSignedTokens = true,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(
                    Encoding.UTF8.GetBytes(jwt.Value.Secret)
                ),
                ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                ClockSkew = TimeSpan.Zero,
            };
            options.Events = new JwtBearerEvents
            {
                // Signature and claims only; ActiveUserMiddleware loads the user after rate limiting.
                OnTokenValidated = context =>
                {
                    if (
                        !Guid.TryParse(
                            context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier),
                            out _
                        )
                    )
                        context.Fail("Invalid subject");
                    return Task.CompletedTask;
                },
                OnChallenge = async c =>
                {
                    c.HandleResponse();
                    c.Response.StatusCode = 401;
                    await c.Response.WriteAsJsonAsync(new Failure("Unauthorized", []));
                },
                OnForbidden = async c =>
                {
                    c.Response.StatusCode = 403;
                    await c.Response.WriteAsJsonAsync(new Failure("Forbidden", []));
                },
            };
        }
    );
builder
    .Services.AddControllers(o => o.Filters.Add<EndpointFilter>())
    .ConfigureApiBehaviorOptions(o =>
    {
        o.SuppressMapClientErrors = true;
        o.InvalidModelStateResponseFactory = c => new BadRequestObjectResult(
            new Failure(
                "Validation failed",
                c.ModelState.Values.SelectMany(v => v.Errors)
                    .Select(e => e.ErrorMessage.Length == 0 ? "Invalid input" : e.ErrorMessage)
                    .ToArray()
            )
        );
    })
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        o.JsonSerializerOptions.Converters.Add(
            new ModularBackend.Api.Contracts.UtcInstantConverter()
        );
    });
builder.Services.Configure<FormOptions>(o =>
    o.MultipartBodyLengthLimit =
        (builder.Configuration.GetValue<long?>("Upload:MaxBytes") ?? 10485760) + 65536
);
builder.WebHost.ConfigureKestrel(o =>
    o.Limits.MaxRequestBodySize =
        (builder.Configuration.GetValue<long?>("Upload:MaxBytes") ?? 10485760) + 65536
);
builder.Services.AddSingleton<RefreshCookies>();
builder.Services.AddCors(o =>
    o.AddDefaultPolicy(p =>
    {
        var origins =
            builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
            ?? (
                builder.Environment.IsDevelopment()
                    ? ["http://localhost:5173", "http://localhost:3000"]
                    : []
            );
        p.WithOrigins(origins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .WithExposedHeaders("X-Request-ID", "X-Next-Cursor");
        // Cookie mode sends the refresh cookie cross-origin, which needs credentialed CORS
        // with the exact origin allowlist above (never a wildcard).
        if (builder.Configuration["RefreshCookie:Transport"] == "cookie")
            p.AllowCredentials();
    })
);
foreach (
    var documentName in new[]
    {
        "v1",
        "auth",
        "user",
        "roles",
        "permissions",
        "upload",
        "notifications",
        "system",
        "docs",
    }
)
{
    builder.Services.AddOpenApi(
        documentName,
        o =>
        {
            o.ShouldInclude = description =>
                documentName == "v1"
                || description
                    .ActionDescriptor.EndpointMetadata.OfType<EndpointAttribute>()
                    .Any(a => Module(a.Id) == documentName);
            o.AddSchemaTransformer<ContractSchemaTransformer>();
            o.AddOperationTransformer<PolicyTransformer>();
            o.AddDocumentTransformer<DocumentTransformer>();
        }
    );
}
builder.Services.AddBackendTelemetry(builder.Configuration);
var app = builder.Build();

// Validates the refresh cookie settings at startup instead of on the first login.
_ = app.Services.GetRequiredService<RefreshCookies>();
app.UseMiddleware<ErrorMiddleware>();
app.UseForwardedHeaders();
app.UseRouting();

// API docs reveal every route and schema; off in production unless Docs__Enabled=true.
var docsEnabled =
    app.Configuration.GetValue<bool?>("Docs:Enabled") ?? !app.Environment.IsProduction();
app.Use(
    async (http, next) =>
    {
        http.Response.Headers.XContentTypeOptions = "nosniff";
        http.Response.Headers.XFrameOptions = "DENY";
        http.Response.Headers["Referrer-Policy"] = "no-referrer";
        http.Response.Headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()";
        if (app.Environment.IsProduction())
            http.Response.Headers.StrictTransportSecurity = "max-age=31536000; includeSubDomains";
        if (!docsEnabled && http.Request.Path.StartsWithSegments("/docs"))
        {
            http.Response.StatusCode = StatusCodes.Status404NotFound;
            await http.Response.WriteAsJsonAsync(new Failure("Not found", []), http.RequestAborted);
            return;
        }
        // JSON endpoints never need the upload-sized body limit; only upload.create keeps it.
        if (
            http.GetEndpoint()?.Metadata.GetMetadata<EndpointAttribute>() is { } endpoint
            && endpoint.Id != EndpointId.UploadCreate
            && http.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit
        )
            limit.MaxRequestBodySize = 1_048_576;
        await next(http);
    }
);
app.UseCors();
app.UseWhen(
    http =>
        http.GetEndpoint()?.Metadata.GetMetadata<EndpointAttribute>() is { } endpoint
        && !http
            .RequestServices.GetRequiredService<EndpointRegistry>()
            .Policies[endpoint.Id]
            .Public,
    branch => branch.UseAuthentication()
);
app.UseMiddleware<RateMiddleware>();
app.UseMiddleware<ActiveUserMiddleware>();
app.UseAuthorization();
app.UseStatusCodePages(async c =>
{
    if (c.HttpContext.Response.ContentLength is null)
        await c.HttpContext.Response.WriteAsJsonAsync(new Failure("Request failed", []));
});
app.MapControllers();
app.Services.GetRequiredService<EndpointRegistry>()
    .Validate(app.Services.GetRequiredService<IActionDescriptorCollectionProvider>());
app.Run();

static bool ValidOrigin(string origin) =>
    Uri.TryCreate(origin, UriKind.Absolute, out var uri)
    && uri.Scheme is "http" or "https"
    && uri.AbsolutePath == "/"
    && uri.Query.Length == 0
    && uri.Fragment.Length == 0
    && uri.UserInfo.Length == 0
    && origin == uri.GetLeftPart(UriPartial.Authority);
static string Module(EndpointId id) =>
    id.ToString() switch
    {
        var name when name.StartsWith("User", StringComparison.Ordinal) => "user",
        var name when name.StartsWith("Role", StringComparison.Ordinal) => "roles",
        var name when name.StartsWith("Permission", StringComparison.Ordinal) => "permissions",
        var name when name.StartsWith("Auth", StringComparison.Ordinal) => "auth",
        var name when name.StartsWith("Upload", StringComparison.Ordinal) => "upload",
        var name when name.StartsWith("Notification", StringComparison.Ordinal) => "notifications",
        var name when name.StartsWith("Docs", StringComparison.Ordinal) => "docs",
        _ => "system",
    };

public partial class Program;
