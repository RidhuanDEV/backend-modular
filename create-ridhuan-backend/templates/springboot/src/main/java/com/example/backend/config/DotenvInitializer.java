package com.example.backend.config;

import java.util.HashMap;
import java.util.Map;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;

public final class DotenvInitializer
    implements ApplicationContextInitializer<ConfigurableApplicationContext> {
  @Override
  public void initialize(ConfigurableApplicationContext context) {
    Map<String, Object> values = new HashMap<>();
    // Missing file is allowed; malformed syntax must fail.
    LocalEnvironment.load(java.nio.file.Path.of(".")).forEach(values::put);
    var sources = context.getEnvironment().getPropertySources();
    if (sources.contains("systemEnvironment"))
      sources.addAfter("systemEnvironment", new MapPropertySource("localDotenv", values));
    else sources.addFirst(new MapPropertySource("localDotenv", values));
    if (context.getEnvironment().getProperty("app.mode", "http").equals("migrate"))
      sources.addFirst(
          new MapPropertySource("migrationOwner", Map.of("spring.jpa.hibernate.ddl-auto", "none")));
  }
}
