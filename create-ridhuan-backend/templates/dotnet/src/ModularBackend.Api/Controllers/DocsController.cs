using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;

namespace ModularBackend.Api.Controllers;

[ApiController]
public sealed class DocsController(IServiceProvider services) : ControllerBase
{
    [HttpGet("docs"), Endpoint(EndpointId.DocsUi), Produces("text/html"), ProducesResponseType(200)]
    public ContentResult Index() => Content("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Modular .NET API</title><h1>API specifications</h1><p><a href=\"/docs/openapi.json\">All modules</a></p>" + string.Join("", new[] { "auth", "user", "roles", "permissions", "upload", "system", "docs" }.Select(m => $"<p><a href=\"/docs/specs/{m}.json\">{m}</a></p>")) + "</html>", "text/html");
    [HttpGet("docs/openapi.json"), Endpoint(EndpointId.DocsSpec), Produces("application/json"), ProducesResponseType(200)]
    public Task<ContentResult> All(CancellationToken ct) => Specification("v1", ct);
    [HttpGet("docs/specs/{module}.json"), Endpoint(EndpointId.DocsModuleSpec), Produces("application/json"), ProducesResponseType(200)]
    public Task<ContentResult> Module(string module, CancellationToken ct)
    {
        if (module is not ("auth" or "user" or "roles" or "permissions" or "upload" or "system" or "docs")) throw new ApiException(404, "Module not found");
        return Specification(module, ct);
    }
    private async Task<ContentResult> Specification(string name, CancellationToken ct)
    {
        var provider = services.GetRequiredKeyedService<IOpenApiDocumentProvider>(name);
        var document = await provider.GetOpenApiDocumentAsync(ct);
        using var writer = new StringWriter(System.Globalization.CultureInfo.InvariantCulture);
        await document.SerializeAsync(new OpenApiJsonWriter(writer), OpenApiSpecVersion.OpenApi3_1, ct);
        return Content(writer.ToString(), "application/json");
    }
}
