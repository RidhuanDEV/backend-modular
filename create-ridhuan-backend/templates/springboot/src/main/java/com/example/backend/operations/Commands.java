package com.example.backend.operations;

import com.example.backend.config.Settings;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.stereotype.Component;

@Component
public class Commands implements ApplicationRunner {
  private final Settings settings;
  private final DataSource source;
  private final SeedService seed;
  private final CleanupService cleanup;
  private final ConfigurableApplicationContext context;

  public Commands(
      Settings settings,
      DataSource source,
      SeedService seed,
      CleanupService cleanup,
      ConfigurableApplicationContext context) {
    this.settings = settings;
    this.source = source;
    this.seed = seed;
    this.cleanup = cleanup;
    this.context = context;
  }

  @Override
  public void run(ApplicationArguments arguments) throws Exception {
    String mode = settings.text("app.mode", "http");
    switch (mode) {
      case "http", "email-worker" -> {}
      case "migrate" -> {
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration/" + settings.provider())
            .load()
            .migrate();
        context.close();
      }
      case "seed" -> {
        seed.seed();
        context.close();
      }
      case "cleanup" -> {
        System.out.println(cleanup.run());
        context.close();
      }
      default -> throw new IllegalArgumentException("Invalid app.mode");
    }
  }
}
