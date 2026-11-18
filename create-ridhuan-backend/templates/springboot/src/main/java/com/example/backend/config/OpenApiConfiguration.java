package com.example.backend.config;

import com.example.backend.platform.endpoint.EndpointRegistry;
import io.swagger.v3.oas.models.*;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.*;
import java.util.List;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.*;

@Configuration
@ConditionalOnWebApplication
public class OpenApiConfiguration {
  @Bean
  OpenAPI apiMetadata(Settings settings) {
    return new OpenAPI()
        .info(new Info().title(settings.text("APP_NAME", "modular-springboot")).version("1.0.0"))
        .components(
            new Components()
                .addSecuritySchemes(
                    "bearerAuth",
                    new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .bearerFormat("JWT")));
  }

  @Bean
  OpenApiCustomizer registryMetadata(EndpointRegistry registry) {
    return document -> {
      if (document.getPaths() == null) return;
      var resolved =
          io.swagger.v3.core.converter.ModelConverters.getInstance()
              .resolveAsResolvedSchema(
                  new io.swagger.v3.core.converter.AnnotatedType(
                      com.example.backend.platform.http.Api.Failure.class));
      if (document.getComponents() == null) document.setComponents(new Components());
      resolved.referencedSchemas.forEach(
          (name, schema) -> document.getComponents().addSchemas(name, schema));
      for (var definition : registry.all()) {
        var path = document.getPaths().get(definition.path());
        if (path == null) continue;
        var operation =
            path.readOperationsMap().get(PathItem.HttpMethod.valueOf(definition.method()));
        if (operation == null) continue;
        operation.setOperationId(definition.id());
        operation.setTags(List.of(definition.module()));
        operation.setSecurity(
            definition.internal()
                ? List.of(new SecurityRequirement().addList("bearerAuth"))
                : List.of());
        operation.addExtension("x-endpoint-policy", definition.id());
        operation.addExtension("x-permission", definition.permission());
        if (operation.getResponses() == null)
          operation.setResponses(new io.swagger.v3.oas.models.responses.ApiResponses());
        for (String code : errorStatuses(definition, operation)) {
          operation
              .getResponses()
              .addApiResponse(
                  code,
                  new io.swagger.v3.oas.models.responses.ApiResponse()
                      .description("Request failed")
                      .content(
                          new io.swagger.v3.oas.models.media.Content()
                              .addMediaType(
                                  "application/json",
                                  new io.swagger.v3.oas.models.media.MediaType()
                                      .schema(resolved.schema))));
        }
        if (REFRESH_COOKIE_OPERATIONS.contains(definition.id()))
          documentRefreshCookie(operation, definition.id(), definition.status(), resolved.schema);
      }
    };
  }

  /**
   * Statuses the pipeline can produce: validation and parsing, authentication and permissions,
   * lookups, integrity conflicts on writes, body limits and media types, rate limiting, database
   * outages and the generic 500.
   */
  private static List<String> errorStatuses(
      com.example.backend.platform.endpoint.EndpointRegistry.Definition definition,
      Operation operation) {
    String id = definition.id();
    boolean write = !definition.method().equals("GET");
    boolean body = operation.getRequestBody() != null;
    boolean input =
        body || (operation.getParameters() != null && !operation.getParameters().isEmpty());
    var codes = new java.util.ArrayList<String>();
    if (input || write) codes.add("400");
    if (definition.internal() || id.equals("auth.login") || id.equals("auth.refresh"))
      codes.add("401");
    if ((definition.permission() != null && !definition.permission().isEmpty())
        || id.equals("auth.refresh")
        || id.equals("auth.logout")) codes.add("403");
    if (definition.path().contains("{")
        || id.startsWith("docs.")
        || id.equals("notification.create")) codes.add("404");
    if (write) codes.add("409");
    if (body) {
      codes.add("413");
      codes.add("415");
    }
    codes.add("429");
    codes.add("500");
    if (!id.equals("health.get") && !id.equals("live.get") && !id.startsWith("docs."))
      codes.add("503");
    return codes;
  }

  private static final java.util.Set<String> REFRESH_COOKIE_OPERATIONS =
      java.util.Set.of("auth.login", "auth.refresh", "auth.logout");

  private static final String REFRESH_COOKIE_MODES =
      "Refresh token transport is set by REFRESH_TOKEN_TRANSPORT. "
          + "body (default): the refresh token travels in JSON. "
          + "cookie: login and refresh set it as an httpOnly cookie scoped to /api/auth and omit"
          + " it from the response body; refresh and logout read the cookie when the body has no"
          + " refreshToken, and then require the X-Requested-With header (send credentials:"
          + " \"include\" cross-origin). A refreshToken in the body always takes precedence.";

  /** Documents both refresh token transports and the auth-specific failures. */
  private static void documentRefreshCookie(
      Operation operation,
      String id,
      int status,
      io.swagger.v3.oas.models.media.Schema<?> failure) {
    operation.setDescription(REFRESH_COOKIE_MODES);
    var success = operation.getResponses().get(String.valueOf(status));
    if (success != null)
      success.addHeaderObject(
          "Set-Cookie",
          new io.swagger.v3.oas.models.headers.Header()
              .description(
                  id.equals("auth.logout")
                      ? "Cookie mode only: clears the refresh cookie"
                      : "Cookie mode only: httpOnly refresh token cookie (Path=/api/auth)")
              .schema(new io.swagger.v3.oas.models.media.StringSchema()));
    var errors = new java.util.LinkedHashMap<String, String>();
    if (id.equals("auth.login")) errors.put("401", "Invalid email or password");
    if (id.equals("auth.refresh"))
      errors.put("401", "Unknown, expired, replayed or revoked refresh token");
    if (!id.equals("auth.login")) {
      errors.put("403", "Refresh cookie sent without the X-Requested-With header");
      operation.addParametersItem(
          new io.swagger.v3.oas.models.parameters.HeaderParameter()
              .name("X-Requested-With")
              .required(false)
              .description("Required (any value) when the refresh token comes from the cookie")
              .schema(new io.swagger.v3.oas.models.media.StringSchema()));
    }
    errors.forEach(
        (code, description) ->
            operation
                .getResponses()
                .addApiResponse(
                    code,
                    new io.swagger.v3.oas.models.responses.ApiResponse()
                        .description(description)
                        .content(
                            new io.swagger.v3.oas.models.media.Content()
                                .addMediaType(
                                    "application/json",
                                    new io.swagger.v3.oas.models.media.MediaType()
                                        .schema(failure)))));
  }
}
