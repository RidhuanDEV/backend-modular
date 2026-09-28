using System.Text.Json.Nodes;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;
using ModularBackend.Api.Contracts;
using ModularBackend.Application;

namespace ModularBackend.Api.OpenApi;

public sealed class ContractSchemaTransformer : IOpenApiSchemaTransformer
{
    public Task TransformAsync(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken ct)
    {
        var type = context.JsonTypeInfo.Type;
        if (type == typeof(Failure) || type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Success<>))
        {
            schema.Required ??= new HashSet<string>(); schema.Required.Add("success");
            if (schema.Properties?.TryGetValue("success", out var property) == true && property is OpenApiSchema success) success.Enum = [JsonValue.Create(type != typeof(Failure))];
        }
        if (type == typeof(UpdateUserRequest) || type == typeof(UpdateRoleRequest) || type == typeof(UpdatePermissionRequest))
            foreach (var property in schema.Properties?.Values.OfType<OpenApiSchema>() ?? Enumerable.Empty<OpenApiSchema>()) property.Type &= ~JsonSchemaType.Null;
        return Task.CompletedTask;
    }
}
