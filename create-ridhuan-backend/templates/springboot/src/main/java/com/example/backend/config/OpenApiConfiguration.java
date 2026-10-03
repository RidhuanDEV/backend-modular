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
        for (String code :
            List.of(
                "400", "401", "403", "404", "405", "406", "409", "413", "415", "429", "500",
                "503")) {
          if (!definition.internal() && (code.equals("401") || code.equals("403"))) continue;
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
      }
    };
  }
}
