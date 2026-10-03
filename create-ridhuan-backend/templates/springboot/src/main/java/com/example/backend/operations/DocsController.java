package com.example.backend.operations;

import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.http.ApiException;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Paths;
import java.util.Locale;
import org.springdoc.core.service.OpenAPIService;
import org.springframework.web.bind.annotation.*;

@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
@RestController
public class DocsController {
  private final OpenAPIService service;
  private final EndpointRegistry registry;
  private final org.springdoc.webmvc.api.OpenApiWebMvcResource resource;

  public DocsController(
      OpenAPIService service,
      EndpointRegistry registry,
      org.springdoc.webmvc.api.OpenApiWebMvcResource resource) {
    this.service = service;
    this.registry = registry;
    this.resource = resource;
  }

  @GetMapping("/docs/specs/{module}.json")
  @EndpointPolicy(EndpointId.DOCS_MODULE_SPEC)
  public OpenAPI module(
      @PathVariable String module, jakarta.servlet.http.HttpServletRequest request)
      throws com.fasterxml.jackson.core.JsonProcessingException {
    if (registry.all().stream().noneMatch(d -> d.module().equals(module)))
      throw ApiException.missing();
    if (service.getCachedOpenAPI(Locale.ROOT) == null)
      resource.openapiJson(request, "/docs/openapi.json", Locale.ROOT);
    OpenAPI source = java.util.Objects.requireNonNull(service.getCachedOpenAPI(Locale.ROOT));
    Paths paths = new Paths();
    registry.all().stream()
        .filter(d -> d.module().equals(module))
        .forEach(
            d -> {
              if (source.getPaths() != null && source.getPaths().containsKey(d.path()))
                paths.addPathItem(d.path(), source.getPaths().get(d.path()));
            });
    return new OpenAPI().info(source.getInfo()).components(source.getComponents()).paths(paths);
  }
}
