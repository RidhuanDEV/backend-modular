using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using ModularBackend.Infrastructure.Observability;
using ModularBackend.Tests;
using OpenTelemetry;
using OpenTelemetry.Exporter;
using OpenTelemetry.Trace;

namespace ModularBackend.UnitTests;

[TestClass]
public sealed class TelemetryTests
{
    [TestMethod]
    public async Task IncomingHttpTraceIsPropagatedWithoutExportingQueryOrHeaders()
    {
        var exporter = new TraceCapture();
        await using var host = new TestHost(
            new Dictionary<string, string?>
            {
                ["Telemetry:Enabled"] = "true",
                ["Telemetry:Endpoint"] = "http://localhost:1",
                ["Rate:Store"] = "memory",
                ["Rate:InstanceCount"] = "1",
            }
        );
        await using var configured = host.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                // Factory configuration is applied after minimal-host registrations;
                // register the same enabled SDK used by a deployed HTTP process.
                services.AddBackendTelemetry(
                    new ConfigurationBuilder()
                        .AddInMemoryCollection(
                            new Dictionary<string, string?>
                            {
                                ["Telemetry:Enabled"] = "true",
                                ["Telemetry:Endpoint"] = "http://localhost:1",
                            }
                        )
                        .Build()
                );
                services
                    .AddOpenTelemetry()
                    .WithTracing(tracing =>
                        tracing.AddProcessor(new SimpleActivityExportProcessor(exporter))
                    );
            })
        );
        using var client = configured.CreateClient();
        const string trace = "0123456789abcdef0123456789abcdef";
        const string sentinel = "private-http-telemetry-fixture";
        using var request = new HttpRequestMessage(HttpMethod.Get, "/live?private=" + sentinel);
        request.Headers.Add("traceparent", "00-" + trace + "-0123456789abcdef-01");
        request.Headers.Add("Authorization", "Bearer " + sentinel);
        using var response = await client.SendAsync(request);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsTrue(
            exporter.Spans.Any(span => span.TraceId == trace),
            "Incoming trace was not propagated"
        );
        Assert.IsFalse(
            exporter.Spans.Any(span => span.Tags.Contains(sentinel, StringComparison.Ordinal))
        );
    }

    private sealed record CapturedSpan(string TraceId, string Tags);

    private sealed class TraceCapture : BaseExporter<Activity>
    {
        public ConcurrentQueue<CapturedSpan> Spans { get; } = new();

        public override ExportResult Export(in Batch<Activity> batch)
        {
            foreach (var activity in batch)
                Spans.Enqueue(
                    new(
                        activity.TraceId.ToString(),
                        string.Join(
                            ";",
                            activity.TagObjects.Select(tag => tag.Key + "=" + tag.Value)
                        )
                    )
                );
            return ExportResult.Success;
        }
    }

    [TestMethod]
    [DataRow("grpc", "http://localhost:4317", "http://localhost:4317/", "http://localhost:4317/")]
    [DataRow(
        "http/protobuf",
        "http://localhost:4318",
        "http://localhost:4318/v1/traces",
        "http://localhost:4318/v1/metrics"
    )]
    [DataRow(
        "http/protobuf",
        "https://collector.example.test/prefix/",
        "https://collector.example.test/prefix/v1/traces",
        "https://collector.example.test/prefix/v1/metrics"
    )]
    public void SignalsHaveIndependentExporterEndpoints(
        string protocol,
        string endpoint,
        string traces,
        string metrics
    )
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["Telemetry:Enabled"] = "true",
                    ["Telemetry:Protocol"] = protocol,
                    ["Telemetry:Endpoint"] = endpoint,
                    ["Telemetry:ServiceName"] = "fixture",
                }
            )
            .Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddBackendTelemetry(config);
        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptionsMonitor<OtlpExporterOptions>>();
        Assert.AreEqual(new Uri(traces), options.Get("backend-traces").Endpoint);
        Assert.AreEqual(new Uri(metrics), options.Get("backend-metrics").Endpoint);
        var expected =
            protocol == "grpc" ? OtlpExportProtocol.Grpc : OtlpExportProtocol.HttpProtobuf;
        Assert.AreEqual(expected, options.Get("backend-traces").Protocol);
        Assert.AreEqual(expected, options.Get("backend-metrics").Protocol);
    }
}
