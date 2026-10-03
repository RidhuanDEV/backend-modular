using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Configuration;
using ModularBackend.Infrastructure.Jobs;
using ModularBackend.Infrastructure.Mail;
using ModularBackend.Infrastructure.Observability;
using ModularBackend.Infrastructure.Persistence;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(45));
builder.Logging.AddBackendJsonLogs();
builder
    .Services.AddOptions<WorkerOptions>()
    .BindConfiguration("Worker")
    .ValidateDataAnnotations()
    .Validate(o => o.RenewSeconds * 2 < o.LeaseSeconds, "Renewal must be less than half the lease")
    .ValidateOnStart();
builder
    .Services.AddOptions<SmtpOptions>()
    .BindConfiguration("Smtp")
    .ValidateDataAnnotations()
    .Validate(
        o =>
            !o.Enabled
            || o.Host.Length > 0
                && o.From.Length > 0
                && (o.User.Length == 0) == (o.Password.Length == 0),
        "Invalid SMTP settings"
    )
    .ValidateOnStart();
builder.Services.AddScoped(_ =>
    DatabaseProvider.Create(
        builder.Configuration["Database:Provider"] ?? "postgresql",
        builder.Configuration["Database:ConnectionString"]
            ?? throw new InvalidOperationException("Database connection required")
    )
);
builder.Services.AddSingleton<INotificationMailSender, SmtpNotificationSender>();
builder.Services.AddHostedService<EmailWorker>();
builder.Services.AddBackendTelemetry(builder.Configuration);
await builder.Build().RunAsync();
