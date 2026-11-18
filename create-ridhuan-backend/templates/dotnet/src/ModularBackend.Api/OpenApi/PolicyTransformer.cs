using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;

namespace ModularBackend.Api.OpenApi;

public sealed class PolicyTransformer(EndpointRegistry registry) : IOpenApiOperationTransformer
{
    public async Task TransformAsync(
        OpenApiOperation operation,
        OpenApiOperationTransformerContext context,
        CancellationToken ct
    )
    {
        var id = context
            .Description.ActionDescriptor.EndpointMetadata.OfType<EndpointAttribute>()
            .Single()
            .Id;
        var policy = registry.Policies[id];
        operation.OperationId = policy.WireId;
        operation.Tags = new HashSet<OpenApiTagReference> { new(policy.Module) };
        operation.Extensions ??= new Dictionary<string, IOpenApiExtension>();
        operation.Extensions["x-audit"] = new JsonNodeExtension(
            JsonValue.Create(policy.Audit.ToString().ToLowerInvariant())
        );
        operation.Extensions["x-rate-limit"] = new JsonNodeExtension(
            JsonValue.Create(policy.RateLimit.ToString().ToLowerInvariant())
        );
        operation.Extensions["x-cache"] = new JsonNodeExtension(
            JsonValue.Create(policy.Cache.ToString().ToLowerInvariant())
        );
        DocumentQueryParameters(operation, context);
        var schema = await context.GetOrCreateSchemaAsync(typeof(Failure), cancellationToken: ct);
        operation.Responses ??= new OpenApiResponses();
        if (
            id == EndpointId.NotificationList
            && operation.Responses.TryGetValue("200", out var response)
            && response is OpenApiResponse page
        )
            page.Headers = new Dictionary<string, IOpenApiHeader>
            {
                ["X-Next-Cursor"] = new OpenApiHeader
                {
                    Description = "UUID cursor for next page; absent on final page",
                    Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "uuid" },
                },
            };
        if (id == EndpointId.NotificationStream)
        {
            operation.Parameters ??= [];
            operation.Parameters.Add(
                new OpenApiParameter
                {
                    Name = "Last-Event-ID",
                    In = ParameterLocation.Header,
                    Required = false,
                    Description = "Last notification UUID for this recipient",
                    Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "uuid" },
                }
            );
            operation.Responses["200"] = new OpenApiResponse
            {
                Description =
                    "Ordered notification SSE, UUID event IDs, heartbeat 15s, maximum 14 minutes or JWT expiry",
                Content = new Dictionary<string, OpenApiMediaType>
                {
                    ["text/event-stream"] = new()
                    {
                        Schema = new OpenApiSchema { Type = JsonSchemaType.String },
                    },
                },
            };
        }
        if (id is EndpointId.AuthLogin or EndpointId.AuthRefresh or EndpointId.AuthLogout)
            DocumentRefreshCookie(operation, id);
        foreach (var status in ErrorStatuses(policy, operation))
            operation.Responses[status] = new OpenApiResponse
            {
                Description = "Error envelope",
                Content = new Dictionary<string, OpenApiMediaType>
                {
                    ["application/json"] = new() { Schema = schema },
                },
            };
    }

    // Statuses the pipeline can produce for this operation: validation and body parsing,
    // authentication and permissions, path lookups, database conflicts on writes, body
    // limits, rate limiting (system probes are exempt), database outages and the 500 handler.
    private static IEnumerable<string> ErrorStatuses(
        EndpointPolicy policy,
        OpenApiOperation operation
    )
    {
        var id = policy.Id;
        var write = policy.Method != "GET";
        var body = operation.RequestBody is not null;
        if (write || body || operation.Parameters is { Count: > 0 })
            yield return "400";
        if (!policy.Public || id is EndpointId.AuthLogin or EndpointId.AuthRefresh)
            yield return "401";
        if (
            !string.IsNullOrEmpty(policy.Permission)
            || id is EndpointId.AuthRefresh or EndpointId.AuthLogout
        )
            yield return "403";
        if (policy.Path.Contains('{') || id == EndpointId.NotificationCreate)
            yield return "404";
        if (write)
            yield return "409";
        if (body)
            yield return "413";
        if (policy.Module != "system")
            yield return "429";
        yield return "500";
        if (
            id
            is not (
                EndpointId.HealthGet
                or EndpointId.LiveGet
                or EndpointId.DocsSpec
                or EndpointId.DocsModuleSpec
                or EndpointId.DocsUi
            )
        )
            yield return "503";
    }

    // Query binding is case-insensitive, but clients should see the camelCase wire names
    // used everywhere else, with the server defaults that make the parameters optional.
    private static void DocumentQueryParameters(
        OpenApiOperation operation,
        OpenApiOperationTransformerContext context
    )
    {
        foreach (var parameter in operation.Parameters?.OfType<OpenApiParameter>() ?? [])
        {
            if (parameter.In != ParameterLocation.Query || string.IsNullOrEmpty(parameter.Name))
                continue;
            var description = context.Description.ParameterDescriptions.FirstOrDefault(d =>
                string.Equals(d.Name, parameter.Name, StringComparison.OrdinalIgnoreCase)
            );
            parameter.Name = JsonNamingPolicy.CamelCase.ConvertName(parameter.Name);
            if (
                (description?.DefaultValue ?? RecordDefault(description)) is { } value
                && parameter.Schema is OpenApiSchema schema
            )
            {
                schema.Default = JsonSerializer.SerializeToNode(value);
                parameter.Required = false;
            }
        }
    }

    // [FromQuery] records expose defaults only on their primary constructor parameters.
    private static object? RecordDefault(ApiParameterDescription? description)
    {
        var metadata = description?.ModelMetadata;
        if (metadata?.ContainerType is not { } container || metadata.PropertyName is not { } name)
            return null;
        return container
            .GetConstructors()
            .SelectMany(c => c.GetParameters())
            .FirstOrDefault(p => p.Name == name && p.HasDefaultValue)
            ?.DefaultValue;
    }

    private const string RefreshCookieModes =
        "Refresh token transport is set by RefreshCookie:Transport (RefreshCookie__Transport). "
        + "body (default): the refresh token travels in JSON. "
        + "cookie: login and refresh set it as an httpOnly cookie scoped to /api/auth and omit it from the response body; "
        + "refresh and logout read the cookie when the body has no refreshToken, and then require the X-Requested-With header (send credentials: \"include\" cross-origin). "
        + "A refreshToken in the body always takes precedence.";

    // Documents both refresh token transports on the endpoints that issue or consume it.
    private static void DocumentRefreshCookie(OpenApiOperation operation, EndpointId id)
    {
        operation.Description = RefreshCookieModes;
        var success = id == EndpointId.AuthLogout ? "204" : "200";
        if (
            operation.Responses is { } responses
            && responses.TryGetValue(success, out var found)
            && found is OpenApiResponse response
        )
            response.Headers = new Dictionary<string, IOpenApiHeader>
            {
                ["Set-Cookie"] = new OpenApiHeader
                {
                    Description =
                        id == EndpointId.AuthLogout
                            ? "Cookie mode only: clears the refresh cookie"
                            : "Cookie mode only: httpOnly refresh token cookie (Path=/api/auth)",
                    Schema = new OpenApiSchema { Type = JsonSchemaType.String },
                },
            };
        if (id == EndpointId.AuthLogin)
            return;
        operation.Parameters ??= [];
        operation.Parameters.Add(
            new OpenApiParameter
            {
                Name = "X-Requested-With",
                In = ParameterLocation.Header,
                Required = false,
                Description = "Required (any value) when the refresh token comes from the cookie",
                Schema = new OpenApiSchema { Type = JsonSchemaType.String },
            }
        );
    }
}

public sealed class DocumentTransformer(EndpointRegistry registry) : IOpenApiDocumentTransformer
{
    public Task TransformAsync(
        OpenApiDocument document,
        OpenApiDocumentTransformerContext context,
        CancellationToken ct
    )
    {
        document.Info = new() { Title = "Modular .NET Backend", Version = "v1" };
        document.Components ??= new();
        document.Components.SecuritySchemes = new Dictionary<string, IOpenApiSecurityScheme>
        {
            ["Bearer"] = new OpenApiSecurityScheme
            {
                Type = SecuritySchemeType.Http,
                Scheme = "bearer",
                BearerFormat = "JWT",
            },
        };
        foreach (
            var operation in document.Paths.Values.SelectMany(p =>
                p.Operations?.Values.AsEnumerable() ?? Enumerable.Empty<OpenApiOperation>()
            )
        )
        {
            var policy = registry.Policies.Values.Single(p => p.WireId == operation.OperationId);
            if (!policy.Public)
                operation.Security =
                [
                    new OpenApiSecurityRequirement
                    {
                        [new OpenApiSecuritySchemeReference("Bearer", document)] = [],
                    },
                ];
        }
        var operations = document
            .Paths.Values.SelectMany(p =>
                p.Operations?.Values.AsEnumerable() ?? Enumerable.Empty<OpenApiOperation>()
            )
            .ToArray();
        if (context.DocumentName == "v1" && operations.Length != registry.Policies.Count)
            throw new InvalidOperationException("OpenAPI incomplete");
        return Task.CompletedTask;
    }
}
