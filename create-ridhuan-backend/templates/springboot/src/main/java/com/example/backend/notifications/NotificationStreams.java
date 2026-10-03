package com.example.backend.notifications;

import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.http.RequestContext;
import com.example.backend.platform.http.StreamTransport;
import jakarta.annotation.PreDestroy;
import jakarta.servlet.http.HttpServletRequest;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.jspecify.annotations.Nullable;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class NotificationStreams {
  private final NotificationService service;
  private final Clock clock;
  private final StreamTransport transport;
  private final Semaphore budget = new Semaphore(16);
  private final ExecutorService executor =
      new ThreadPoolExecutor(16, 16, 0, TimeUnit.SECONDS, new SynchronousQueue<>());
  private final Set<SseEmitter> active = ConcurrentHashMap.newKeySet();

  public NotificationStreams(
      NotificationService service,
      Clock clock,
      StreamTransport transport,
      io.micrometer.core.instrument.MeterRegistry metrics) {
    this.service = service;
    this.clock = clock;
    this.transport = transport;
    io.micrometer.core.instrument.Gauge.builder("backend.sse.connections", active, Set::size)
        .register(metrics);
  }

  public SseEmitter open(
      UUID actor, @Nullable UUID cursor, Instant expiry, HttpServletRequest request) {
    long start = service.cursor(actor, cursor);
    var connection = transport.bind(request);
    if (!budget.tryAcquire()) throw new ApiException(503, "Stream connection limit reached");
    long lifetime = Math.min(840000, Duration.between(clock.instant(), expiry).toMillis());
    if (lifetime <= 0) {
      budget.release();
      throw ApiException.unauthorized();
    }
    SseEmitter emitter = new SseEmitter(lifetime);
    AtomicBoolean done = new AtomicBoolean(false);
    active.add(emitter);
    Runnable finish =
        () -> {
          if (done.compareAndSet(false, true)) {
            active.remove(emitter);
            budget.release();
          }
        };
    emitter.onCompletion(finish);
    emitter.onTimeout(
        () -> {
          finish.run();
          emitter.complete();
        });
    emitter.onError(e -> finish.run());
    var context = RequestContext.current();
    var traceContext = io.opentelemetry.context.Context.current();
    try {
      executor.submit(
          () -> {
            try (var scope = traceContext.makeCurrent()) {
              if (context != null) {
                MDC.put("requestId", context.requestId());
                MDC.put("endpointId", context.endpoint().wire());
              }
              long after = start;
              Instant end = clock.instant().plusMillis(lifetime), heartbeat = clock.instant();
              while (!done.get() && connection.active() && clock.instant().isBefore(end)) {
                var batch = service.batch(actor, after, cursor == null);
                for (var item : batch) {
                  if (done.get()) break;
                  emitter.send(
                      SseEmitter.event()
                          .id(item.response().id().toString())
                          .name("notification")
                          .data(item.response()));
                  after = item.sequence();
                }
                if (batch.size() == 50) continue;
                if (!clock.instant().isBefore(heartbeat)) {
                  emitter.send(SseEmitter.event().comment("heartbeat"));
                  heartbeat = clock.instant().plusSeconds(15);
                }
                Thread.sleep(3000);
              }
            } catch (InterruptedException e) {
              Thread.currentThread().interrupt();
            } catch (Exception e) {
              org.slf4j.LoggerFactory.getLogger(getClass())
                  .debug("stream_closed type={}", e.getClass().getSimpleName());
            } finally {
              finish.run();
              emitter.complete();
              MDC.remove("requestId");
              MDC.remove("endpointId");
            }
          });
    } catch (RejectedExecutionException failure) {
      finish.run();
      emitter.complete();
      throw new ApiException(503, "Stream connection limit reached");
    }
    return emitter;
  }

  @PreDestroy
  public void shutdown() {
    for (var emitter : active) emitter.complete();
    executor.shutdownNow();
  }
}
