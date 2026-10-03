using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ModularBackend.Tests;

public sealed class TestHost(IReadOnlyDictionary<string, string?>? settings = null)
    : WebApplicationFactory<Program>
{
    private static string Provider
    {
        get
        {
            if (Environment.GetEnvironmentVariable("Database__Provider") is { } configured)
                return configured;
            if (!File.Exists("backend-template.json"))
                return "postgresql";
            using var marker = JsonDocument.Parse(File.ReadAllText("backend-template.json"));
            return marker.RootElement.GetProperty("databaseProvider").GetString()
                ?? throw new InvalidOperationException("Missing generated provider");
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration(
            (_, config) =>
                config
                    .AddInMemoryCollection(
                        new Dictionary<string, string?>
                        {
                            ["Database:Provider"] = Provider,
                            ["Database:ConnectionString"] =
                                Environment.GetEnvironmentVariable("Database__ConnectionString")
                                ?? (
                                    Provider == "mysql"
                                        ? "Server=localhost;Port=1;Database=unavailable;User ID=test;Password=test;Connection Timeout=1;SslMode=Preferred"
                                        : "Host=localhost;Port=1;Database=unavailable;Username=test;Password=test;Timeout=1"
                                ),
                            ["Jwt:Secret"] = new string('t', 64),
                            ["Jwt:Issuer"] = "modular-net",
                            ["Jwt:Audience"] = "modular-net-clients",
                            ["Rate:Auth:Max"] = "10000",
                            ["Rate:Public:Max"] = "10000",
                            ["Rate:Internal:Max"] = "10000",
                            ["Upload:LocalRoot"] = Path.Combine(
                                Path.GetTempPath(),
                                "modular-net-test-uploads"
                            ),
                            ["ENDPOINT_POLICIES_JSON"] = "{}",
                            ["Cache:Enabled"] = "false",
                        }
                    )
                    .AddInMemoryCollection(settings ?? new Dictionary<string, string?>())
        );
    }
}
