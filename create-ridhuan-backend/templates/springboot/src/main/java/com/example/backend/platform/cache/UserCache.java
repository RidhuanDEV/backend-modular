package com.example.backend.platform.cache;

import com.example.backend.auth.AuthService;
import com.example.backend.config.Settings;
import com.example.backend.platform.http.Api;
import com.example.backend.platform.jobs.Db;
import com.example.backend.platform.observability.Telemetry;
import com.example.backend.users.UserDto;
import java.time.Duration;
import java.util.*;
import org.jspecify.annotations.Nullable;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.*;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Component
public final class UserCache {
  private final Settings settings;
  private final StringRedisTemplate redis;
  private final ObjectMapper mapper;
  private final Db db;
  private final Telemetry telemetry;

  public UserCache(
      Settings settings,
      StringRedisTemplate redis,
      ObjectMapper mapper,
      Db db,
      Telemetry telemetry) {
    this.db = db;
    this.telemetry = telemetry;
    this.settings = settings;
    this.redis = redis;
    this.mapper = mapper;
  }

  public String key(UUID actor, UserDto.Query query) {
    String raw =
        settings.text("REDIS_NAMESPACE", "backend")
            + ":users:"
            + actor
            + ":"
            + AuthService.hash(query.toString());
    if (!settings.bool("CACHE_ENABLED", false)) return raw;
    try {
      return versioned(raw);
    } catch (RuntimeException e) {
      return raw + ":unavailable";
    }
  }

  public Api.@Nullable Success<List<UserDto.Projection>> get(String key) {
    if (!settings.bool("CACHE_ENABLED", false)) return null;
    try {
      String value =
          telemetry.observe(Telemetry.Operation.redis_query, () -> redis.opsForValue().get(key));
      return value == null
          ? null
          : mapper.readValue(value, new TypeReference<Api.Success<List<UserDto.Projection>>>() {});
    } catch (RuntimeException e) {
      return null;
    }
  }

  public void put(String key, Api.Success<List<UserDto.Projection>> value) {
    if (!settings.bool("CACHE_ENABLED", false)) return;
    try {
      String json = mapper.writeValueAsString(value);
      if (json.length() <= 1048576) redis.opsForValue().set(key, json, Duration.ofSeconds(60));
    } catch (RuntimeException e) {
      org.slf4j.LoggerFactory.getLogger(getClass()).debug("cache_bypass");
    }
  }

  public void invalidate() {
    db.update("UPDATE operation_state SET generation=generation+1 WHERE name='user_cache'");
    if (!settings.bool("CACHE_ENABLED", false)) return;
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            try {
              redis
                  .opsForValue()
                  .increment(settings.text("REDIS_NAMESPACE", "backend") + ":users:version");
            } catch (RuntimeException e) {
              org.slf4j.LoggerFactory.getLogger(getClass()).warn("cache_invalidation_unavailable");
            }
          }
        });
  }

  private String versioned(String key) {
    return key + ":" + db.count("SELECT generation FROM operation_state WHERE name='user_cache'");
  }
}
