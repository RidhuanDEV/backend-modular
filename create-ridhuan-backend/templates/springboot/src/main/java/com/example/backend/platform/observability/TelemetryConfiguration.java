package com.example.backend.platform.observability;

import com.example.backend.platform.jobs.Db;
import io.micrometer.core.instrument.*;
import io.micrometer.core.instrument.config.MeterFilter;
import org.springframework.context.annotation.*;

@Configuration
public class TelemetryConfiguration {
  @Bean
  MeterFilter boundedLabels() {
    return MeterFilter.maximumAllowableTags("http.server.requests", "uri", 128, MeterFilter.deny());
  }

  @Bean
  org.springframework.boot.ApplicationRunner outboxMetrics(Db db, MeterRegistry registry) {
    return arguments -> {
      Gauge.builder(
              "backend.outbox.backlog",
              db,
              d -> {
                try {
                  return d.count(
                      "SELECT COUNT(*) FROM email_jobs WHERE status IN ('PENDING','LEASED')");
                } catch (RuntimeException e) {
                  return Double.NaN;
                }
              })
          .register(registry);
      Gauge.builder(
              "backend.outbox.oldest_age",
              db,
              d -> {
                try {
                  var rows =
                      d.query(
                          "SELECT MIN(created_at) AS oldest FROM email_jobs WHERE status IN ('PENDING','LEASED')",
                          (r, i) -> Db.optionalInstant(r, "oldest"));
                  var oldest = rows.isEmpty() ? null : rows.getFirst();
                  return oldest == null
                      ? 0
                      : java.time.Duration.between(oldest, java.time.Instant.now()).toSeconds();
                } catch (RuntimeException e) {
                  return Double.NaN;
                }
              })
          .register(registry);
    };
  }
}
