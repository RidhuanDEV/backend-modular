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
using ModularBackend.Infrastructure.Persistence;
using ModularBackend.Infrastructure.Security;
using ModularBackend.Infrastructure.Storage;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);
var isDocumentGeneration = System.Reflection.Assembly.GetEntryAssembly()?.GetName().Name == "GetDocument.Insider";
if (isDocumentGeneration)
{
    builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();
    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Database:Provider"] = "postgresql",
        ["Database:ConnectionString"] = "Host=127.0.0.1;Port=1;Database=openapi_only;Username=design;Password=design-only",
        ["Jwt:Secret"] = new string('g', 64),
        ["Cache:Enabled"] = "false",
        ["Rate:Store"] = "memory",
        ["Rate:InstanceCount"] = "1",
        ["Telemetry:Enabled"] = "false",
        ["Cors:Origins:0"] = "https://openapi.example",
        ["ENDPOINT_POLICIES_JSON"] = "{}"
    });
}
builder.Logging.ClearProviders(); builder.Logging.AddJsonConsole();
builder.Services.AddOptions<DatabaseOptions>().BindConfiguration("Database").ValidateDataAnnotations().Validate(o => DatabaseProvider.IsValid(o.Provider, o.ConnectionString), "Invalid database provider/connection string").ValidateOnStart();
builder.Services.AddOptions<JwtOptions>().BindConfiguration("Jwt").ValidateDataAnnotations().Validate(o => !o.Secret.Contains("CHANGE_ME", StringComparison.OrdinalIgnoreCase) && Encoding.UTF8.GetByteCount(o.Secret) >= 32, "JWT secret must be generated").ValidateOnStart();
builder.Services.AddOptions<CacheOptions>().BindConfiguration("Cache").ValidateDataAnnotations().ValidateOnStart();
builder.Services.AddOptions<RedisOptions>().BindConfiguration("Redis").Validate(o => !(builder.Configuration.GetValue<bool>("Cache:Enabled") || builder.Configuration["Rate:Store"] == "redis") || !string.IsNullOrWhiteSpace(o.ConnectionString), "Redis connection string required").ValidateOnStart();
builder.Services.AddOptions<RateOptions>().BindConfiguration("Rate").ValidateDataAnnotations().Validate(o => o.Store is "memory" or "redis" && (o.InstanceCount == 1 || o.Store == "redis") && new[] { o.Auth, o.Public, o.Internal }.All(w => w.Max > 0 && w.WindowMs > 0), "Invalid rate limiter configuration").ValidateOnStart();
// One check per rule so a misconfigured deployment names the exact setting that failed.
builder.Services.AddOptions<UploadOptions>().BindConfiguration("Upload").ValidateDataAnnotations()
    .Validate(o => o.Storage is "local" or "s3", "Upload:Storage must be local or s3")
    .Validate(o => o.AllowedMime.Length > 0 && o.AllowedMime.All(m => m is "image/png" or "image/jpeg" or "application/pdf"), "Upload:AllowedMime must list image/png, image/jpeg or application/pdf")
    .Validate(o => o.Storage != "s3" || !string.IsNullOrWhiteSpace(o.Bucket), "Upload:Bucket is required for s3 storage")
    .Validate(o => (o.AccessKey.Length == 0) == (o.SecretKey.Length == 0), "Upload:AccessKey and Upload:SecretKey must be set together")
    .Validate(o => !string.IsNullOrWhiteSpace(o.LocalRoot), "Upload:LocalRoot is required")
    .Validate(o => !string.IsNullOrWhiteSpace(o.Region), "Upload:Region is required")
    .Validate(o => o.Endpoint.Length == 0 || Uri.TryCreate(o.Endpoint, UriKind.Absolute, out var endpoint) && endpoint.Scheme is "http" or "https", "Upload:Endpoint must be an absolute http(s) URL")
    .ValidateOnStart();
builder.Services.AddOptions<ModularBackend.Infrastructure.Configuration.CorsOptions>().BindConfiguration("Cors").Validate(o => (!builder.Environment.IsProduction() || o.Origins.Length > 0) && o.Origins.All(ValidOrigin), "Explicit valid CORS origins required in production").ValidateOnStart();
builder.Services.AddOptions<TelemetryOptions>().BindConfiguration("Telemetry").Validate(o => !o.Enabled || Uri.TryCreate(o.Endpoint, UriKind.Absolute, out var url) && url.Scheme is "http" or "https", "Invalid telemetry endpoint").ValidateOnStart();
builder.Services.AddOptions<ProxyOptions>().BindConfiguration("Proxy").Validate(o => o.ForwardLimit is > 0 and <= 10 && o.KnownProxies.All(ip => System.Net.IPAddress.TryParse(ip, out _)), "Explicit valid proxy IPs required").ValidateOnStart();
builder.Services.AddOptions<SmtpOptions>().BindConfiguration("Smtp").Validate(o => !o.Enabled || o.Host.Length > 0 && o.From.Length > 0 && (o.User.Length == 0) == (o.Password.Length == 0) && System.Net.Mail.MailAddress.TryCreate(o.From, out _), "Invalid SMTP configuration").ValidateOnStart();
builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(o =>
{
    var proxy = builder.Configuration.GetSection("Proxy").Get<ProxyOptions>() ?? new();
    o.ForwardedHeaders = proxy.KnownProxies.Length == 0 ? Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.None : Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    o.KnownProxies.Clear(); o.KnownIPNetworks.Clear();
    foreach (var ip in proxy.KnownProxies) o.KnownProxies.Add(System.Net.IPAddress.Parse(ip));
    o.ForwardLimit = proxy.ForwardLimit;
});
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<EndpointRegistry>(); builder.Services.AddSingleton<RedisConnection>(); builder.Services.AddSingleton<EndpointLimiter>();
var databaseProvider = builder.Configuration["Database:Provider"] ?? "postgresql";
if (!isDocumentGeneration) DatabaseProvider.ValidateGeneratedProvider(databaseProvider);
if (databaseProvider == "mysql")
{
    builder.Services.AddDbContext<MySqlBackendDbContext>((services, options) => options.UseMySQL(services.GetRequiredService<IOptions<DatabaseOptions>>().Value.ConnectionString, mysql => mysql.CommandTimeout(10)).AddInterceptors(new MySqlUtcInterceptor()));
    builder.Services.AddScoped<BackendDbContext>(services => services.GetRequiredService<MySqlBackendDbContext>());
}
else builder.Services.AddDbContext<BackendDbContext>((services, options) => options.UseNpgsql(services.GetRequiredService<IOptions<DatabaseOptions>>().Value.ConnectionString, npgsql => npgsql.CommandTimeout(10)));
builder.Services.AddScoped<IBackendStore, BackendStore>(); builder.Services.AddScoped<BackendService>(); builder.Services.AddScoped<UploadService>();
builder.Services.AddScoped<INotificationStore, NotificationStore>(); builder.Services.AddScoped<NotificationService>(); builder.Services.AddSingleton<INotificationMailSender, SmtpNotificationSender>();
builder.Services.AddSingleton<IPasswordService, PasswordService>(); builder.Services.AddSingleton<ITokenService, TokenService>();
builder.Services.AddSingleton<IAuditFailureReporter, AuditFailureReporter>(); builder.Services.AddSingleton<ObjectStorage>(); builder.Services.AddSingleton<IObjectStorage>(s => s.GetRequiredService<ObjectStorage>());
builder.Services.AddScoped<ResponseCache>(); builder.Services.AddScoped<ICacheInvalidation>(s => s.GetRequiredService<ResponseCache>());
builder.Services.AddHttpContextAccessor(); builder.Services.AddScoped<IAuthorizationHandler, PermissionHandler>();
builder.Services.AddAuthorization(options => { foreach (var name in new[] { "manage_users", "manage_roles", "manage_permissions", "manage_uploads", "manage_notifications" }) options.AddPolicy(name, p => p.RequireAuthenticatedUser().AddRequirements(new PermissionRequirement(name))); });
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme).Configure<IOptions<JwtOptions>>((options, jwt) =>
{
    options.TokenValidationParameters = new TokenValidationParameters { ValidateIssuer = true, ValidIssuer = jwt.Value.Issuer, ValidateAudience = true, ValidAudience = jwt.Value.Audience, ValidateLifetime = true, RequireExpirationTime = true, RequireSignedTokens = true, ValidateIssuerSigningKey = true, IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Value.Secret)), ValidAlgorithms = [SecurityAlgorithms.HmacSha256], ClockSkew = TimeSpan.Zero };
    options.Events = new JwtBearerEvents
    {
        OnTokenValidated = async context =>
        {
            if (!Guid.TryParse(context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var id)) { context.Fail("Invalid subject"); return; }
            var user = await context.HttpContext.RequestServices.GetRequiredService<IBackendStore>().UserAsync(id, context.HttpContext.RequestAborted);
            if (user is null) { context.Fail("Inactive user"); return; }
            if (context.Principal?.Identity is ClaimsIdentity identity)
            {
                foreach (var claim in identity.FindAll("roleId").ToArray()) identity.RemoveClaim(claim);
                identity.AddClaim(new Claim("roleId", user.RoleId.ToString()));
                foreach (var claim in identity.FindAll(ClaimTypes.Email).ToArray()) identity.RemoveClaim(claim);
                identity.AddClaim(new Claim(ClaimTypes.Email, user.Email));
            }
        },
        OnChallenge = async c => { c.HandleResponse(); c.Response.StatusCode = 401; await c.Response.WriteAsJsonAsync(new Failure("Unauthorized", [])); },
        OnForbidden = async c => { c.Response.StatusCode = 403; await c.Response.WriteAsJsonAsync(new Failure("Forbidden", [])); }
    };
});
builder.Services.AddControllers(o => o.Filters.Add<EndpointFilter>()).ConfigureApiBehaviorOptions(o =>
{
    o.SuppressMapClientErrors = true;
    o.InvalidModelStateResponseFactory = c => new BadRequestObjectResult(new Failure("Validation failed", c.ModelState.Values.SelectMany(v => v.Errors).Select(e => e.ErrorMessage.Length == 0 ? "Invalid input" : e.ErrorMessage).ToArray()));
}).AddJsonOptions(o => { o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull; o.JsonSerializerOptions.Converters.Add(new ModularBackend.Api.Contracts.UtcInstantConverter()); });
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = (builder.Configuration.GetValue<long?>("Upload:MaxBytes") ?? 10485760) + 65536);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = (builder.Configuration.GetValue<long?>("Upload:MaxBytes") ?? 10485760) + 65536);
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? (builder.Environment.IsDevelopment() ? ["http://localhost:5173", "http://localhost:3000"] : []);
    p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
}));
foreach (var documentName in new[] { "v1", "auth", "user", "roles", "permissions", "upload", "notifications", "system", "docs" })
{
    builder.Services.AddOpenApi(documentName, o =>
    {
        o.ShouldInclude = description => documentName == "v1" || description.ActionDescriptor.EndpointMetadata.OfType<EndpointAttribute>().Any(a => Module(a.Id) == documentName);
        o.AddSchemaTransformer<ContractSchemaTransformer>(); o.AddOperationTransformer<PolicyTransformer>(); o.AddDocumentTransformer<DocumentTransformer>();
    });
}
var telemetry = builder.Configuration.GetSection("Telemetry").Get<TelemetryOptions>() ?? new();
if (telemetry.Enabled) builder.Services.AddOpenTelemetry().ConfigureResource(r => r.AddService(telemetry.ServiceName)).WithTracing(t => t.AddSource("Npgsql", "ModularBackend.Storage", "ModularBackend.Redis").AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddOtlpExporter(o => o.Endpoint = new Uri(telemetry.Endpoint))).WithMetrics(m => m.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddOtlpExporter(o => o.Endpoint = new Uri(telemetry.Endpoint)));
var app = builder.Build();
app.UseMiddleware<ErrorMiddleware>(); app.UseForwardedHeaders(); app.UseRouting(); app.UseCors(); app.UseWhen(http => http.GetEndpoint()?.Metadata.GetMetadata<EndpointAttribute>() is { } endpoint && !http.RequestServices.GetRequiredService<EndpointRegistry>().Policies[endpoint.Id].Public, branch => branch.UseAuthentication()); app.UseMiddleware<RateMiddleware>(); app.UseAuthorization();
app.UseStatusCodePages(async c => { if (c.HttpContext.Response.ContentLength is null) await c.HttpContext.Response.WriteAsJsonAsync(new Failure("Request failed", [])); });
app.MapControllers();
app.Services.GetRequiredService<EndpointRegistry>().Validate(app.Services.GetRequiredService<IActionDescriptorCollectionProvider>());
app.Run();

static bool ValidOrigin(string origin) => Uri.TryCreate(origin, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0 && uri.UserInfo.Length == 0 && origin == uri.GetLeftPart(UriPartial.Authority);
static string Module(EndpointId id) => id.ToString() switch { var name when name.StartsWith("User", StringComparison.Ordinal) => "user", var name when name.StartsWith("Role", StringComparison.Ordinal) => "roles", var name when name.StartsWith("Permission", StringComparison.Ordinal) => "permissions", var name when name.StartsWith("Auth", StringComparison.Ordinal) => "auth", var name when name.StartsWith("Upload", StringComparison.Ordinal) => "upload", var name when name.StartsWith("Notification", StringComparison.Ordinal) => "notifications", var name when name.StartsWith("Docs", StringComparison.Ordinal) => "docs", _ => "system" };
public partial class Program;
