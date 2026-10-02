using System.Text.Json.Nodes;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;

namespace ModularBackend.Api.OpenApi;

public sealed class PolicyTransformer(EndpointRegistry registry) : IOpenApiOperationTransformer
{
    public async Task TransformAsync(OpenApiOperation operation, OpenApiOperationTransformerContext context, CancellationToken ct)
    {
        var id = context.Description.ActionDescriptor.EndpointMetadata.OfType<EndpointAttribute>().Single().Id;
        var policy = registry.Policies[id];
        operation.OperationId = policy.WireId;
        operation.Tags = new HashSet<OpenApiTagReference> { new(policy.Module) };
        operation.Extensions ??= new Dictionary<string, IOpenApiExtension>();
        operation.Extensions["x-audit"] = new JsonNodeExtension(JsonValue.Create(policy.Audit.ToString().ToLowerInvariant()));
        operation.Extensions["x-rate-limit"] = new JsonNodeExtension(JsonValue.Create(policy.RateLimit.ToString().ToLowerInvariant()));
        operation.Extensions["x-cache"] = new JsonNodeExtension(JsonValue.Create(policy.Cache.ToString().ToLowerInvariant()));
        var schema = await context.GetOrCreateSchemaAsync(typeof(Failure), cancellationToken: ct);
        operation.Responses ??= new OpenApiResponses();
        if (id == EndpointId.NotificationList && operation.Responses.TryGetValue("200", out var response) && response is OpenApiResponse page)
            page.Headers = new Dictionary<string, IOpenApiHeader> { ["X-Next-Cursor"] = new OpenApiHeader { Description = "UUID cursor for next page; absent on final page", Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "uuid" } } };
        if (id == EndpointId.NotificationStream)
        {
            operation.Parameters ??= [];
            operation.Parameters.Add(new OpenApiParameter { Name = "Last-Event-ID", In = ParameterLocation.Header, Required = false, Description = "Last notification UUID for this recipient", Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "uuid" } });
            operation.Responses["200"] = new OpenApiResponse { Description = "Ordered notification SSE, UUID event IDs, heartbeat 15s, maximum 14 minutes or JWT expiry", Content = new Dictionary<string, OpenApiMediaType> { ["text/event-stream"] = new() { Schema = new OpenApiSchema { Type = JsonSchemaType.String } } } };
        }
        foreach (var status in new[] { "400", "401", "403", "404", "409", "413", "429", "500", "503" })
            operation.Responses[status] = new OpenApiResponse { Description = "Error envelope", Content = new Dictionary<string, OpenApiMediaType> { ["application/json"] = new() { Schema = schema } } };
    }
}
public sealed class DocumentTransformer(EndpointRegistry registry) : IOpenApiDocumentTransformer
{
    public Task TransformAsync(OpenApiDocument document, OpenApiDocumentTransformerContext context, CancellationToken ct)
    {
        document.Info = new() { Title = "Modular .NET Backend", Version = "v1" };
        document.Components ??= new();
        document.Components.SecuritySchemes = new Dictionary<string, IOpenApiSecurityScheme> { ["Bearer"] = new OpenApiSecurityScheme { Type = SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT" } };
        foreach (var operation in document.Paths.Values.SelectMany(p => p.Operations?.Values.AsEnumerable() ?? Enumerable.Empty<OpenApiOperation>()))
        {
            var policy = registry.Policies.Values.Single(p => p.WireId == operation.OperationId);
            if (!policy.Public) operation.Security = [new OpenApiSecurityRequirement { [new OpenApiSecuritySchemeReference("Bearer", document)] = [] }];
        }
        var operations = document.Paths.Values.SelectMany(p => p.Operations?.Values.AsEnumerable() ?? Enumerable.Empty<OpenApiOperation>()).ToArray();
        if (context.DocumentName == "v1" && operations.Length != registry.Policies.Count) throw new InvalidOperationException("OpenAPI incomplete");
        return Task.CompletedTask;
    }
}
