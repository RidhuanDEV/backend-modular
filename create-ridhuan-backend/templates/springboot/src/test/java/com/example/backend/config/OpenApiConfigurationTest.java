package com.example.backend.config;

import static org.junit.jupiter.api.Assertions.*;

import com.example.backend.platform.endpoint.EndpointRegistry;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.json.JsonMapper;

class OpenApiConfigurationTest {
  private static Operation post(String status) {
    return new Operation()
        .responses(new ApiResponses().addApiResponse(status, new ApiResponse().description("ok")));
  }

  @Test
  void refreshCookieTransportAndAuthFailuresAreDocumented() throws Exception {
    var settings =
        new Settings(
            new MockEnvironment()
                .withProperty("DB_PASSWORD", "test-only-password")
                .withProperty("JWT_SECRET", "test-only-secret-32-bytes-minimum-value"));
    var registry = new EndpointRegistry(settings, JsonMapper.builder().build());
    var statuses =
        Map.of("/api/auth/login", "200", "/api/auth/refresh", "200", "/api/auth/logout", "204");
    var paths = new Paths();
    statuses.forEach((path, status) -> paths.addPathItem(path, new PathItem().post(post(status))));
    var document = new OpenAPI().paths(paths);
    new OpenApiConfiguration().registryMetadata(registry).customise(document);
    statuses.forEach(
        (path, status) -> {
          var operation = Objects.requireNonNull(document.getPaths().get(path)).getPost();
          assertTrue(operation.getDescription().contains("REFRESH_TOKEN_TRANSPORT"), path);
          assertNotNull(
              Objects.requireNonNull(operation.getResponses().get(status))
                  .getHeaders()
                  .get("Set-Cookie"),
              path);
          var header =
              operation.getParameters() == null
                  ? null
                  : operation.getParameters().stream()
                      .filter(p -> p.getName().equals("X-Requested-With"))
                      .findFirst()
                      .orElse(null);
          if (path.equals("/api/auth/login")) {
            assertNull(header);
            assertNotNull(operation.getResponses().get("401"));
            assertNull(operation.getResponses().get("403"));
          } else {
            assertNotNull(header, path);
            assertEquals("header", header.getIn());
            assertFalse(header.getRequired());
            assertNotNull(operation.getResponses().get("403"), path);
          }
        });
    assertNotNull(
        Objects.requireNonNull(document.getPaths().get("/api/auth/refresh"))
            .getPost()
            .getResponses()
            .get("401"));
  }

  @Test
  void operationsDocumentOnlyErrorsTheirPipelineReturns() throws Exception {
    var settings =
        new Settings(
            new MockEnvironment()
                .withProperty("DB_PASSWORD", "test-only-password")
                .withProperty("JWT_SECRET", "test-only-secret-32-bytes-minimum-value"));
    var registry = new EndpointRegistry(settings, JsonMapper.builder().build());
    var paths = new Paths();
    for (String path : List.of("/ready", "/live", "/api/users", "/api/users/{id}"))
      paths.addPathItem(path, new PathItem().get(post("200")));
    var document = new OpenAPI().paths(paths);
    new OpenApiConfiguration().registryMetadata(registry).customise(document);
    java.util.function.Function<String, List<String>> errors =
        path ->
            Objects.requireNonNull(document.getPaths().get(path))
                .getGet()
                .getResponses()
                .keySet()
                .stream()
                .filter(code -> code.charAt(0) >= '4')
                .sorted()
                .toList();
    assertEquals(List.of("429", "500", "503"), errors.apply("/ready"));
    assertEquals(List.of("429", "500"), errors.apply("/live"));
    assertEquals(List.of("401", "403", "429", "500", "503"), errors.apply("/api/users"));
    assertTrue(errors.apply("/api/users/{id}").contains("404"));
  }
}
