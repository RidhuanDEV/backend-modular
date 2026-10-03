package com.example.backend.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class PlatformConfiguration {
  @Bean
  Clock clock() {
    return Clock.systemUTC();
  }
}
