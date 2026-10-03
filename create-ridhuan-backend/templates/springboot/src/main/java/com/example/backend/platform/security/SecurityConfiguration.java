package com.example.backend.platform.security;

import com.example.backend.config.Settings;
import com.example.backend.platform.http.Api;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.*;
import tools.jackson.databind.ObjectMapper;

@Configuration
public class SecurityConfiguration {
  @Bean
  PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
  }

  @Bean
  JwtEncoder encoder(Settings settings) {
    return new NimbusJwtEncoder(
        new ImmutableSecret<>(settings.text("JWT_SECRET", "").getBytes(StandardCharsets.UTF_8)));
  }

  @Bean
  JwtDecoder decoder(Settings settings) {
    var decoder =
        NimbusJwtDecoder.withSecretKey(
                new SecretKeySpec(
                    settings.text("JWT_SECRET", "").getBytes(StandardCharsets.UTF_8), "HmacSHA256"))
            .macAlgorithm(MacAlgorithm.HS256)
            .build();
    OAuth2TokenValidator<Jwt> custom =
        jwt ->
            jwt.getAudience() != null
                    && jwt.getAudience()
                        .contains(settings.text("JWT_AUDIENCE", "modular-springboot"))
                    && jwt.getExpiresAt() != null
                    && "access".equals(jwt.getClaimAsString("token_use"))
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
    decoder.setJwtValidator(
        new DelegatingOAuth2TokenValidator<>(
            new JwtTimestampValidator(java.time.Duration.ZERO),
            new JwtIssuerValidator(settings.text("JWT_ISSUER", "modular-springboot")),
            custom));
    return decoder;
  }

  @Bean
  CorsConfigurationSource cors(Settings settings) {
    var c = new CorsConfiguration();
    c.setAllowedOrigins(
        Arrays.stream(settings.text("CORS_ORIGINS", "http://localhost:3000").split(","))
            .map(String::trim)
            .toList());
    c.setAllowedMethods(List.of("GET", "POST", "PATCH", "DELETE", "OPTIONS"));
    c.setAllowedHeaders(
        List.of("Authorization", "Content-Type", "Accept", "Last-Event-ID", "X-Request-ID"));
    c.setExposedHeaders(List.of("X-Request-ID", "X-Next-Cursor"));
    c.setAllowCredentials(false);
    var source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", c);
    return source;
  }

  @Bean
  @org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
  SecurityFilterChain security(HttpSecurity http, ObjectMapper mapper) throws Exception {
    http.csrf(c -> c.disable())
        .cors(c -> {})
        .sessionManagement(c -> c.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            c ->
                c.dispatcherTypeMatchers(
                        jakarta.servlet.DispatcherType.ASYNC, jakarta.servlet.DispatcherType.ERROR)
                    .permitAll()
                    .requestMatchers(
                        "/api/auth/register",
                        "/api/auth/login",
                        "/api/auth/refresh",
                        "/api/auth/logout",
                        "/health",
                        "/live",
                        "/ready",
                        "/docs",
                        "/docs/**",
                        "/swagger-ui/**",
                        "/error")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .oauth2ResourceServer(
            c ->
                c.jwt(j -> {})
                    .authenticationEntryPoint(
                        (r, s, e) -> {
                          s.setStatus(401);
                          s.setContentType("application/json");
                          mapper.writeValue(s.getOutputStream(), Api.Failure.of("Unauthorized"));
                        }))
        .exceptionHandling(
            c ->
                c.accessDeniedHandler(
                    (r, s, e) -> {
                      s.setStatus(403);
                      s.setContentType("application/json");
                      mapper.writeValue(s.getOutputStream(), Api.Failure.of("Forbidden"));
                    }));
    return http.build();
  }
}
