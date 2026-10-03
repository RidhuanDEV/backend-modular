package com.example.backend.platform.mail;

import com.example.backend.config.Settings;
import com.example.backend.platform.observability.Telemetry;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.context.SmartLifecycle;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

@Component
public class EmailWorker implements SmartLifecycle {
  private final Settings settings;
  private final EmailJobs jobs;
  private final JavaMailSender sender;
  private final MeterRegistry metrics;
  private final Telemetry telemetry;
  private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);
  private final ExecutorService deliveries;
  private final Semaphore capacity;
  private final AtomicBoolean running = new AtomicBoolean();

  public EmailWorker(
      Settings settings,
      EmailJobs jobs,
      JavaMailSender sender,
      MeterRegistry metrics,
      Telemetry telemetry) {
    this.telemetry = telemetry;
    this.settings = settings;
    this.jobs = jobs;
    this.sender = sender;
    this.metrics = metrics;
    int threads = settings.integer("EMAIL_WORKER_CONCURRENCY", 2, 1, 16);
    deliveries = Executors.newFixedThreadPool(threads);
    capacity = new Semaphore(threads);
  }

  @Override
  public boolean isAutoStartup() {
    return settings.text("app.mode", "http").equals("email-worker");
  }

  @Override
  public void start() {
    running.set(true);
    if (settings.bool("SMTP_ENABLED", false))
      scheduler.scheduleWithFixedDelay(
          this::poll, 0, settings.integer("EMAIL_POLL_SECONDS", 3, 1, 60), TimeUnit.SECONDS);
  }

  private void poll() {
    if (!running.get()) return;
    while (running.get() && capacity.tryAcquire()) {
      EmailJobs.Claim claim;
      try {
        claim = jobs.claim();
      } catch (RuntimeException e) {
        capacity.release();
        metrics.counter("backend.outbox.errors", "operation", "claim").increment();
        return;
      }
      if (claim == null) {
        capacity.release();
        return;
      }
      deliveries.submit(() -> deliver(claim));
    }
  }

  private void deliver(EmailJobs.Claim claim) {
    AtomicBoolean owned = new AtomicBoolean(true);
    ScheduledFuture<?> renewal =
        scheduler.scheduleWithFixedDelay(
            () -> {
              try {
                if (!jobs.renew(claim)) owned.set(false);
              } catch (RuntimeException e) {
                owned.set(false);
              }
            },
            settings.integer("EMAIL_RENEW_SECONDS", 20, 1, 120),
            settings.integer("EMAIL_RENEW_SECONDS", 20, 1, 120),
            TimeUnit.SECONDS);
    var context = io.opentelemetry.context.Context.root();
    String parent = claim.traceParent();
    if (parent != null && parent.matches("00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]")) {
      var remote =
          io.opentelemetry.api.trace.SpanContext.createFromRemoteParent(
              parent.substring(3, 35),
              parent.substring(36, 52),
              io.opentelemetry.api.trace.TraceFlags.fromHex(parent, 53),
              io.opentelemetry.api.trace.TraceState.getDefault());
      context = context.with(io.opentelemetry.api.trace.Span.wrap(remote));
    }
    if (claim.requestId() != null) org.slf4j.MDC.put("requestId", claim.requestId());
    org.slf4j.MDC.put("jobId", claim.id().toString());
    try (var scope = context.makeCurrent()) {
      if (!owned.get()) return;
      var message = new SimpleMailMessage();
      message.setFrom(settings.text("SMTP_FROM", "noreply@example.com"));
      message.setTo(claim.recipient());
      message.setSubject(claim.title());
      message.setText(claim.body());
      telemetry.observe(
          Telemetry.Operation.email_delivery,
          () -> {
            sender.send(message);
            return true;
          });
      if (owned.get()) jobs.finish(claim, true);
      metrics.counter("backend.email.attempts", "status", "sent").increment();
    } catch (RuntimeException failure) {
      if (owned.get())
        try {
          jobs.finish(claim, false);
        } catch (RuntimeException e) {
          metrics.counter("backend.outbox.errors", "operation", "completion").increment();
        }
      metrics.counter("backend.outbox.deliveries", "status", "retry").increment();
    } finally {
      renewal.cancel(false);
      capacity.release();
      org.slf4j.MDC.remove("requestId");
      org.slf4j.MDC.remove("jobId");
    }
  }

  @Override
  public void stop() {
    running.set(false);
    deliveries.shutdown();
    try {
      if (!deliveries.awaitTermination(30, TimeUnit.SECONDS)) deliveries.shutdownNow();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      deliveries.shutdownNow();
    }
    scheduler.shutdownNow();
  }

  @Override
  public boolean isRunning() {
    return running.get();
  }

  @Override
  public int getPhase() {
    return 100;
  }
}
