package com.example.backend.platform.endpoint;

import java.util.*;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

@Configuration
public class MappingVerifier {
  @Bean
  ApplicationRunner verifyMappings(
      EndpointRegistry registry,
      @Qualifier("requestMappingHandlerMapping")
          org.springframework.beans.factory.ObjectProvider<RequestMappingHandlerMapping> mapping) {
    return args -> {
      if (mapping.getIfAvailable() == null) return;
      Set<EndpointId> seen = EnumSet.noneOf(EndpointId.class);
      Objects.requireNonNull(mapping.getIfAvailable())
          .getHandlerMethods()
          .forEach(
              (info, method) -> {
                EndpointPolicy annotation = method.getMethodAnnotation(EndpointPolicy.class);
                if (annotation == null) return;
                var policy = registry.get(annotation.value());
                if (!info.getPatternValues().contains(policy.path())
                    || info.getMethodsCondition().getMethods().stream()
                        .noneMatch(m -> m.name().equals(policy.method())))
                  throw new IllegalStateException("Controller/registry mismatch: " + policy.id());
                seen.add(annotation.value());
              });
      seen.add(EndpointId.DOCS_SPEC);
      seen.add(EndpointId.DOCS_UI);
      for (EndpointId id : EndpointId.values())
        if (!seen.contains(id))
          throw new IllegalStateException("Missing endpoint controller: " + id.wire());
    };
  }
}
