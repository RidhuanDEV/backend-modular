using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ModularBackend.Infrastructure.Configuration;
using OpenTelemetry;
using OpenTelemetry.Exporter;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace ModularBackend.Infrastructure.Observability;

public static class BackendTelemetry
{
    public const string Name = "ModularBackend.Operations";
    public static readonly ActivitySource Source = new(Name);
    public static readonly ActivitySource Storage = new("ModularBackend.Storage");
    public static readonly ActivitySource Redis = new("ModularBackend.Redis");
    public static readonly Meter Meter = new(Name);
    public static readonly Counter<long> Requests = Meter.CreateCounter<long>(
        "backend.http.requests"
    );
    public static readonly Counter<long> Errors = Meter.CreateCounter<long>("backend.http.errors");
    public static readonly Histogram<double> Duration = Meter.CreateHistogram<double>(
        "backend.http.duration",
        "s"
    );
    public static readonly UpDownCounter<long> Sse = Meter.CreateUpDownCounter<long>(
        "backend.sse.connections"
    );
    public static readonly Counter<long> Email = Meter.CreateCounter<long>(
        "backend.email.attempts"
    );
    public static readonly Counter<long> Cleanup = Meter.CreateCounter<long>(
        "backend.cleanup.items"
    );
    public static readonly Gauge<long> Backlog = Meter.CreateGauge<long>("backend.outbox.backlog");
    public static readonly Gauge<double> Oldest = Meter.CreateGauge<double>(
        "backend.outbox.oldest_age",
        "s"
    );

    public static IServiceCollection AddBackendTelemetry(
        this IServiceCollection services,
        IConfiguration configuration
    )
    {
        var options = configuration.GetSection("Telemetry").Get<TelemetryOptions>() ?? new();
        if (!options.Enabled)
            return services;
        if (
            !Uri.TryCreate(options.Endpoint, UriKind.Absolute, out var endpoint)
            || endpoint.Scheme is not ("http" or "https")
            || endpoint.UserInfo.Length > 0
            || endpoint.Query.Length > 0
            || endpoint.Fragment.Length > 0
        )
            throw new InvalidOperationException("Invalid Telemetry:Endpoint");
        if (!Regex.IsMatch(options.ServiceName, "^[A-Za-z0-9._-]{1,80}$"))
            throw new InvalidOperationException("Invalid Telemetry:ServiceName");
        var protocol = options.Protocol switch
        {
            "grpc" => OtlpExportProtocol.Grpc,
            "http/protobuf" => OtlpExportProtocol.HttpProtobuf,
            _ => throw new InvalidOperationException(
                "Telemetry:Protocol must be grpc or http/protobuf"
            ),
        };
        Uri SignalEndpoint(string signal) =>
            protocol == OtlpExportProtocol.HttpProtobuf
                ? new UriBuilder(endpoint)
                {
                    Path = endpoint.AbsolutePath.TrimEnd('/') + "/v1/" + signal,
                }.Uri
                : endpoint;
        services
            .AddOpenTelemetry()
            .ConfigureResource(r => r.AddService(options.ServiceName))
            .WithTracing(t =>
                t.AddSource(Name, "ModularBackend.Storage", "ModularBackend.Redis")
                    .AddAspNetCoreInstrumentation(o => o.RecordException = false)
                    .AddHttpClientInstrumentation(o => o.RecordException = false)
                    .AddProcessor(new SafeTags())
                    .AddOtlpExporter(
                        "backend-traces",
                        o =>
                        {
                            o.Endpoint = SignalEndpoint("traces");
                            o.Protocol = protocol;
                            o.TimeoutMilliseconds = 2000;
                        }
                    )
            )
            .WithMetrics(m =>
                m.AddMeter(Name)
                    .AddOtlpExporter(
                        "backend-metrics",
                        o =>
                        {
                            o.Endpoint = SignalEndpoint("metrics");
                            o.Protocol = protocol;
                            o.TimeoutMilliseconds = 2000;
                        }
                    )
            );
        return services;
    }

    // Export only bounded operation labels. SQL, URLs, object keys and credentials are excluded.
    private sealed class SafeTags : BaseProcessor<Activity>
    {
        public override void OnEnd(Activity activity)
        {
            if (activity.GetTagItem("operationId") is null)
                activity.SetTag(
                    "operationId",
                    activity.Parent?.GetTagItem("operationId") ?? "operations.worker"
                );
            foreach (var tag in activity.TagObjects.ToArray())
                if (tag.Key is not ("operationId" or "status" or "outcome"))
                    activity.SetTag(tag.Key, null);
        }
    }
}
