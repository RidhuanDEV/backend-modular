package com.example.backend.platform.ratelimit;

import com.example.backend.config.Settings;
import com.example.backend.platform.endpoint.EndpointRegistry.Rate;
import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.observability.Telemetry;
import com.github.benmanes.caffeine.cache.*;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

@Component
public final class Quota {
  private record Window(long slot, AtomicLong used) {}

  private final Cache<String, Window> windows =
      Caffeine.newBuilder().maximumSize(100000).expireAfterAccess(Duration.ofHours(1)).build();
  private final Settings settings;
  private final StringRedisTemplate redis;
  private final Clock clock;
  private final Telemetry telemetry;
  private static final DefaultRedisScript<Long> SCRIPT =
      new DefaultRedisScript<>(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n",
          Long.class);

  public Quota(Settings settings, StringRedisTemplate redis, Clock clock, Telemetry telemetry) {
    this.telemetry = telemetry;
    this.settings = settings;
    this.redis = redis;
    this.clock = clock;
  }

  public boolean ready() {
    if (settings.rateStore() != Settings.RateStore.redis) return true;
    try {
      return "PONG"
          .equals(
              redis.execute(
                  (org.springframework.data.redis.core.RedisCallback<String>) c -> c.ping()));
    } catch (RuntimeException e) {
      return false;
    }
  }

  public void consume(Rate group, String identity) {
    String prefix =
        group == Rate.publicGroup ? "PUBLIC" : group.name().toUpperCase(java.util.Locale.ROOT);
    int seconds = settings.integer("RATE_" + prefix + "_WINDOW_SECONDS", 60, 1, 3600),
        max =
            settings.integer("RATE_" + prefix + "_MAX", group == Rate.auth ? 30 : 300, 1, 10000000);
    long slot = clock.instant().getEpochSecond() / seconds;
    String key = group.name() + ":" + identity;
    long count;
    if (settings.rateStore() == Settings.RateStore.redis) {
      try {
        Long result =
            telemetry.observe(
                Telemetry.Operation.redis_mutation,
                () ->
                    redis.execute(
                        SCRIPT,
                        List.of(
                            settings.text("REDIS_NAMESPACE", "backend")
                                + ":quota:"
                                + key
                                + ":"
                                + slot),
                        Integer.toString(seconds * 1000)));
        if (result == null) throw new IllegalStateException("No quota result");
        count = result;
      } catch (RuntimeException e) {
        if (group == Rate.auth) throw new ApiException(503, "Service unavailable");
        count = local(key, slot);
      }
    } else count = local(key, slot);
    if (count > max) throw new ApiException(429, "Too many requests");
  }

  private long local(String key, long slot) {
    Window window =
        windows
            .asMap()
            .compute(
                key,
                (k, old) ->
                    old == null || old.slot() != slot ? new Window(slot, new AtomicLong()) : old);
    return java.util.Objects.requireNonNull(window).used().incrementAndGet();
  }
}
