package com.example.backend.platform.endpoint;

import com.example.backend.config.Settings;
import java.io.InputStream;
import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public final class EndpointRegistry {
  public enum Audit {
    required,
    optional,
    none
  }

  public enum Capability {
    transaction,
    read,
    none
  }

  public enum Cache {
    read,
    off
  }

  public enum Rate {
    auth,
    publicGroup,
    internal
  }

  public record Definition(
      String id,
      String method,
      String path,
      String module,
      boolean internal,
      String permission,
      Audit audit,
      Capability auditCapability,
      Cache cache,
      Rate rateLimit,
      int status,
      String mediaType,
      String requestDto,
      String responseDto) {}

  private final Map<EndpointId, Definition> definitions = new EnumMap<>(EndpointId.class);

  public EndpointRegistry(Settings settings, ObjectMapper mapper) throws Exception {
    try (InputStream input =
        Objects.requireNonNull(getClass().getResourceAsStream("/contracts/endpoints.json"))) {
      JsonNode entries = mapper.readTree(input).get("operations");
      for (JsonNode n : entries) {
        EndpointId id = EndpointId.wire(n.get("id").asText());
        definitions.put(
            id,
            new Definition(
                id.wire(),
                n.get("method").asText(),
                n.get("path").asText(),
                n.get("module").asText(),
                n.get("internal").asBoolean(),
                n.get("permission").asText(),
                Audit.valueOf(n.get("audit").asText()),
                Capability.valueOf(n.get("auditCapability").asText()),
                Cache.valueOf(n.get("cache").asText()),
                rate(n.get("rateLimit").asText()),
                n.get("status").asInt(),
                n.get("mediaType").asText(),
                n.get("requestDto").asText(),
                n.get("responseDto").asText()));
      }
    }
    JsonNode overrides = mapper.readTree(settings.text("ENDPOINT_POLICIES_JSON", "{}"));
    if (!overrides.isObject()) throw new IllegalArgumentException("Invalid ENDPOINT_POLICIES_JSON");
    for (String key : overrides.propertyNames()) {
      EndpointId id = EndpointId.wire(key);
      Definition d = get(id);
      JsonNode v = overrides.get(key);
      if (!v.isObject()) throw new IllegalArgumentException("Invalid endpoint override");
      for (String field : v.propertyNames())
        if (!Set.of("audit", "cache", "rateLimit").contains(field))
          throw new IllegalArgumentException("Unknown policy key");
      Audit audit = v.has("audit") ? Audit.valueOf(v.get("audit").asText()) : d.audit();
      Cache cache = v.has("cache") ? Cache.valueOf(v.get("cache").asText()) : d.cache();
      Rate rate = v.has("rateLimit") ? rate(v.get("rateLimit").asText()) : d.rateLimit();
      if (audit != Audit.none && d.auditCapability() != Capability.transaction)
        throw new IllegalArgumentException("Audit producer unavailable");
      if (cache == Cache.read
          && (!d.method().equals("GET") || d.mediaType().equals("text/event-stream")))
        throw new IllegalArgumentException("Endpoint cannot be cached");
      definitions.put(
          id,
          new Definition(
              d.id(),
              d.method(),
              d.path(),
              d.module(),
              d.internal(),
              d.permission(),
              audit,
              d.auditCapability(),
              cache,
              rate,
              d.status(),
              d.mediaType(),
              d.requestDto(),
              d.responseDto()));
    }
  }

  public Definition get(EndpointId id) {
    return Objects.requireNonNull(definitions.get(id));
  }

  public Collection<Definition> all() {
    return List.copyOf(definitions.values());
  }

  private static Rate rate(String v) {
    return switch (v) {
      case "auth" -> Rate.auth;
      case "public" -> Rate.publicGroup;
      case "internal" -> Rate.internal;
      default -> throw new IllegalArgumentException("Invalid rate group");
    };
  }
}
