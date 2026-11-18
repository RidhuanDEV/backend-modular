using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using ModularBackend.Api.Endpoints;
using ModularBackend.Tests;

namespace ModularBackend.ContractTests;

[TestClass]
public sealed class HttpContractTests
{
    [TestMethod]
    public async Task DocumentsUserListQueryAsWireNamesWithDefaults()
    {
        await using var host = new TestHost();
        using var client = host.CreateClient();
        using var doc = JsonDocument.Parse(await client.GetStringAsync("/docs/openapi.json"));
        var parameters = doc
            .RootElement.GetProperty("paths")
            .GetProperty("/api/users")
            .GetProperty("get")
            .GetProperty("parameters")
            .EnumerateArray()
            .Where(p => p.GetProperty("in").GetString() == "query")
            .ToDictionary(p => p.GetProperty("name").GetString() ?? "", p => p.Clone());
        CollectionAssert.AreEquivalent(
            new[] { "page", "limit", "sortBy", "orderBy", "search", "fields" },
            parameters.Keys.ToArray()
        );
        foreach (var (name, parameter) in parameters)
            Assert.IsFalse(
                parameter.TryGetProperty("required", out var required) && required.GetBoolean(),
                name
            );
        Assert.AreEqual(
            1,
            parameters["page"].GetProperty("schema").GetProperty("default").GetInt32()
        );
        Assert.AreEqual(
            10,
            parameters["limit"].GetProperty("schema").GetProperty("default").GetInt32()
        );
    }

    [TestMethod]
    public async Task DocumentsOnlyErrorsThePipelineCanReturn()
    {
        await using var host = new TestHost();
        using var client = host.CreateClient();
        using var doc = JsonDocument.Parse(await client.GetStringAsync("/docs/openapi.json"));
        var paths = doc.RootElement.GetProperty("paths");
        string[] Codes(string path, string method) =>
            paths
                .GetProperty(path)
                .GetProperty(method)
                .GetProperty("responses")
                .EnumerateObject()
                .Select(r => r.Name)
                .Where(code => code[0] is '4' or '5')
                .Order()
                .ToArray();
        CollectionAssert.AreEqual(new[] { "500", "503" }, Codes("/ready", "get"));
        CollectionAssert.AreEqual(new[] { "500" }, Codes("/live", "get"));
        CollectionAssert.AreEqual(
            new[] { "400", "401", "403", "429", "500", "503" },
            Codes("/api/users", "get")
        );
        CollectionAssert.Contains(Codes("/api/users/{id}", "get"), "404");
        CollectionAssert.DoesNotContain(Codes("/api/auth/login", "post"), "403");
        CollectionAssert.Contains(Codes("/api/auth/login", "post"), "401");
    }

    [TestMethod]
    public async Task DocumentsRefreshCookieTransport()
    {
        await using var host = new TestHost();
        using var client = host.CreateClient();
        using var doc = JsonDocument.Parse(await client.GetStringAsync("/docs/openapi.json"));
        var paths = doc.RootElement.GetProperty("paths");
        foreach (
            var (path, status) in new[]
            {
                ("/api/auth/login", "200"),
                ("/api/auth/refresh", "200"),
                ("/api/auth/logout", "204"),
            }
        )
        {
            var operation = paths.GetProperty(path).GetProperty("post");
            StringAssert.Contains(operation.GetProperty("description").GetString(), "Transport");
            Assert.IsTrue(
                operation
                    .GetProperty("responses")
                    .GetProperty(status)
                    .GetProperty("headers")
                    .TryGetProperty("Set-Cookie", out _),
                path
            );
            var header = operation.TryGetProperty("parameters", out var parameters)
                ? parameters
                    .EnumerateArray()
                    .Where(p => p.GetProperty("name").GetString() == "X-Requested-With")
                    .ToArray()
                : [];
            Assert.HasCount(path == "/api/auth/login" ? 0 : 1, header, path);
            if (header.Length == 1)
                Assert.AreEqual("header", header[0].GetProperty("in").GetString());
        }
    }

    [TestMethod]
    public async Task DocumentsContainAllRegistryOperationsAndRuntimeValidationEnvelopes()
    {
        await using var host = new TestHost();
        using var client = host.CreateClient();
        using var response = await client.GetAsync("/docs/openapi.json");
        var raw = await response.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode, raw);
        using var doc = JsonDocument.Parse(raw);
        var schemas = doc.RootElement.GetProperty("components").GetProperty("schemas");
        Assert.IsFalse(schemas.GetProperty("UserProjection").TryGetProperty("required", out _));
        Assert.IsFalse(schemas.GetProperty("UpdateUserRequest").TryGetProperty("required", out _));
        Assert.IsTrue(
            schemas
                .GetProperty("SuccessOfAuthUserResult")
                .GetProperty("required")
                .EnumerateArray()
                .Any(v => v.GetString() == "success")
        );
        var multipart = doc
            .RootElement.GetProperty("paths")
            .GetProperty("/api/upload")
            .GetProperty("post")
            .GetProperty("requestBody")
            .GetProperty("content");
        Assert.IsTrue(multipart.TryGetProperty("multipart/form-data", out var form));
        Assert.IsTrue(
            form.GetProperty("schema").GetProperty("properties").TryGetProperty("file", out _)
        );
        var ids = doc
            .RootElement.GetProperty("paths")
            .EnumerateObject()
            .SelectMany(p => p.Value.EnumerateObject())
            .Select(p => p.Value.GetProperty("operationId").GetString())
            .ToArray();
        var registry = new EndpointRegistry(new ConfigurationBuilder().Build());
        Assert.HasCount(registry.Policies.Count, ids);
        foreach (var policy in registry.Policies.Values)
            Assert.IsTrue(ids.Contains(policy.WireId), policy.WireId);
        foreach (var route in new[] { "/health", "/live", "/docs", "/docs/specs/auth.json" })
        {
            using var result = await client.GetAsync(route);
            Assert.AreEqual(HttpStatusCode.OK, result.StatusCode, route);
        }
        using var invalid = await client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "invalid", password = "x" }
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var invalidJson = JsonDocument.Parse(await invalid.Content.ReadAsStringAsync());
        Assert.IsFalse(invalidJson.RootElement.GetProperty("success").GetBoolean());
        Assert.IsGreaterThan(0, invalidJson.RootElement.GetProperty("errors").GetArrayLength());
        using var denied = await client.GetAsync("/api/users");
        Assert.AreEqual(HttpStatusCode.Unauthorized, denied.StatusCode);
        using var deniedJson = JsonDocument.Parse(await denied.Content.ReadAsStringAsync());
        Assert.IsFalse(deniedJson.RootElement.GetProperty("success").GetBoolean());
        using var invalidToken = new HttpRequestMessage(HttpMethod.Get, "/api/users");
        invalidToken.Headers.Authorization = new("Bearer", "invalid");
        using var failed = await client.SendAsync(invalidToken);
        Assert.AreEqual(HttpStatusCode.Unauthorized, failed.StatusCode);
    }

    [TestMethod]
    public void UnknownPolicyAndUnsupportedRequiredGetFailStartup()
    {
        foreach (
            var raw in new[]
            {
                "{\"unknown\":{\"audit\":\"none\"}}",
                "{\"user.get\":{\"audit\":\"required\"}}",
                "{\"user.get\":{\"extra\":true}}",
                "{\"user.get\":{\"cache\":12}}",
            }
        )
        {
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(
                    new Dictionary<string, string?> { ["ENDPOINT_POLICIES_JSON"] = raw }
                )
                .Build();
            Assert.Throws<Exception>(() => new EndpointRegistry(configuration));
        }
    }

    [TestMethod]
    public void RegistryDefaultsMatchReferenceFixture()
    {
        using var fixture = JsonDocument.Parse(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "express-endpoints.json"))
        );
        var registry = new EndpointRegistry(new ConfigurationBuilder().Build());
        using var extensions = JsonDocument.Parse(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "notification-endpoints.json"))
        );
        foreach (
            var row in fixture
                .RootElement.GetProperty("endpoints")
                .EnumerateArray()
                .Concat(extensions.RootElement.GetProperty("endpoints").EnumerateArray())
        )
        {
            var expected = registry.Policies.Values.Single(p => p.WireId == row[0].GetString());
            Assert.AreEqual(row[1].GetString(), expected.Method);
            Assert.AreEqual(row[2].GetString(), expected.Path);
            Assert.AreEqual(row[3].GetString(), expected.Module);
            Assert.AreEqual(row[4].GetBoolean(), expected.Public);
            Assert.AreEqual(row[5].GetString(), expected.Permission);
            Assert.AreEqual(row[6].GetString(), expected.Audit.ToString().ToLowerInvariant());
            Assert.AreEqual(row[7].GetString(), expected.RateLimit.ToString().ToLowerInvariant());
            Assert.AreEqual(row[8].GetString(), expected.Cache.ToString().ToLowerInvariant());
            Assert.AreEqual(row[9].GetInt32(), expected.Status);
        }
    }
}
