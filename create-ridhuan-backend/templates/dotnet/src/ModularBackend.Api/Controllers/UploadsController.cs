using Microsoft.AspNetCore.Mvc;
using ModularBackend.Api.Authorization;
using ModularBackend.Api.Contracts;
using ModularBackend.Api.Endpoints;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Caching;
using FileResult = ModularBackend.Application.FileResult;

namespace ModularBackend.Api.Controllers;

using Microsoft.Extensions.Options;
using ModularBackend.Infrastructure.Configuration;

[ApiController, Route("api/upload")]
public sealed class UploadsController(
    BackendService backend,
    UploadService uploads,
    EndpointRegistry registry,
    ResponseCache cache,
    IOptions<UploadOptions> options
) : ControllerBase
{
    private OperationContext Context =>
        EndpointFilter.Context(HttpContext, registry.Get(HttpContext));

    [
        HttpPost,
        Endpoint(EndpointId.UploadCreate),
        Consumes("multipart/form-data"),
        ProducesResponseType<Success<FileResult>>(201)
    ]
    public async Task<ActionResult<Success<FileResult>>> Create(
        IFormFile file,
        CancellationToken ct
    )
    {
        if (!options.Value.Enabled)
            throw new ApiException(404, "Uploads disabled");
        await using var stream = file.OpenReadStream();
        return StatusCode(
            201,
            new Success<FileResult>(
                await uploads.CreateAsync(
                    stream,
                    file.FileName,
                    file.ContentType,
                    options.Value.MaxBytes,
                    options.Value.AllowedMime,
                    Context,
                    ct
                )
            )
        );
    }

    [
        HttpGet("{id}"),
        Endpoint(EndpointId.UploadGet),
        ProducesResponseType<Success<FileResult>>(200)
    ]
    public async Task<ActionResult<Success<FileResult>>> Get(Guid id, CancellationToken ct) =>
        Ok(
            new Success<FileResult>(
                await cache.ReadAsync(
                    "upload:" + Context.Actor?.Id + ":" + id,
                    registry.Get(HttpContext).Cache == CacheMode.Read,
                    token => backend.FileAsync(id, token),
                    f => f.Id == id && f.Size > 0,
                    ct
                )
            )
        );
}
