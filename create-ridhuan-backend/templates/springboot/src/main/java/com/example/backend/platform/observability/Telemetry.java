package com.example.backend.platform.observability;

import com.example.backend.config.Settings;
import io.micrometer.observation.*;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

@Component
public final class Telemetry {
  public enum Operation {
    jdbc_query,
    jdbc_mutation,
    storage_upload,
    storage_download,
    storage_cleanup,
    redis_query,
    redis_mutation,
    email_delivery,
    cleanup
  }

  private final ObservationRegistry registry;
  private final Settings settings;

  public Telemetry(ObservationRegistry registry, Settings settings) {
    this.registry = registry;
    this.settings = settings;
  }

  public <T extends @Nullable Object> T observe(Operation operation, Supplier<T> action) {
    if (!settings.bool("OTEL_ENABLED", false)) return action.get();
    var observation =
        Observation.createNotStarted("backend.operation", registry)
            .lowCardinalityKeyValue("operation", operation.name())
            .start();
    try (var scope = observation.openScope()) {
      return action.get();
    } catch (RuntimeException failure) {
      observation.error(new IllegalStateException("Operation failed"));
      throw failure;
    } finally {
      observation.stop();
    }
  }

  @FunctionalInterface
  public interface IoAction<T extends @Nullable Object> {
    T run() throws java.io.IOException;
  }

  public <T extends @Nullable Object> T observeIo(Operation operation, IoAction<T> action)
      throws java.io.IOException {
    if (!settings.bool("OTEL_ENABLED", false)) return action.run();
    var observation =
        Observation.createNotStarted("backend.operation", registry)
            .lowCardinalityKeyValue("operation", operation.name())
            .start();
    try (var scope = observation.openScope()) {
      return action.run();
    } catch (java.io.IOException | RuntimeException failure) {
      observation.error(new IllegalStateException("Operation failed"));
      throw failure;
    } finally {
      observation.stop();
    }
  }
}
