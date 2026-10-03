package com.example.backend;

import com.example.backend.config.DotenvInitializer;
import com.example.backend.operations.OfflineCommands;
import java.util.TimeZone;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BackendApplication {
  public static void main(String[] args) throws Exception {
    TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
    if (OfflineCommands.run(args)) return;
    SpringApplication application = new SpringApplication(BackendApplication.class);
    application.addInitializers(new DotenvInitializer());
    String mode = OfflineCommands.mode(args);
    application.setDefaultProperties(
        java.util.Map.of(
            "spring.main.web-application-type",
            mode.equals("http") ? "servlet" : "none",
            "spring.jpa.hibernate.ddl-auto",
            mode.equals("migrate") ? "none" : "validate"));
    application.run(args);
  }
}
