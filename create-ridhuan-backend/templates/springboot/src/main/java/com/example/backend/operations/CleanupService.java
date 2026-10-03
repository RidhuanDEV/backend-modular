package com.example.backend.operations;

import com.example.backend.config.Settings;
import com.example.backend.platform.jobs.Db;
import com.example.backend.platform.storage.ObjectStorage;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class CleanupService {
  public record Result(long families, long jobs, long files, long audits, boolean dryRun) {}

  private final Db db;
  private final Settings settings;
  private final Clock clock;
  private final ObjectStorage storage;
  private final TransactionTemplate transaction;
  private final io.micrometer.core.instrument.MeterRegistry metrics;

  public CleanupService(
      Db db,
      Settings settings,
      Clock clock,
      ObjectStorage storage,
      org.springframework.transaction.PlatformTransactionManager manager,
      io.micrometer.core.instrument.MeterRegistry metrics) {
    this.metrics = metrics;
    this.db = db;
    this.settings = settings;
    this.clock = clock;
    this.storage = storage;
    transaction = new TransactionTemplate(manager);
  }

  public Result run() throws java.io.IOException {
    boolean dry = settings.bool("CLEANUP_DRY_RUN", true);
    int batch = settings.integer("CLEANUP_BATCH", 500, 1, 5000);
    Instant now = clock.instant(),
        cutoff =
            now.minus(Duration.ofDays(settings.integer("CLEANUP_RETENTION_DAYS", 30, 1, 36500)));
    long families =
        Objects.requireNonNull(
            transaction.execute(
                s -> {
                  var ids =
                      db.query(
                          "SELECT id FROM refresh_families WHERE (revoked_at IS NOT NULL AND revoked_at<?) OR (revoked_at IS NULL AND expires_at<?) ORDER BY id LIMIT "
                              + batch
                              + " FOR UPDATE SKIP LOCKED",
                          (r, i) -> Db.uuid(r, "id"),
                          cutoff,
                          cutoff);
                  if (!dry) deleteBatch("refresh_families", ids);
                  return (long) ids.size();
                }));
    long jobs =
        Objects.requireNonNull(
            transaction.execute(
                s -> {
                  var ids =
                      db.query(
                          "SELECT id FROM email_jobs WHERE status IN ('SENT','FAILED') AND completed_at<? ORDER BY id LIMIT "
                              + batch
                              + " FOR UPDATE SKIP LOCKED",
                          (r, i) -> Db.uuid(r, "id"),
                          cutoff);
                  if (!dry) deleteBatch("email_jobs", ids);
                  return (long) ids.size();
                }));
    var files = new java.util.concurrent.atomic.AtomicLong();
    UUID lease = UUID.randomUUID();
    boolean owned =
        dry
            || db.update(
                    "UPDATE operation_state SET lease_id=?,lease_until=? WHERE name='cleanup_uploads' AND (lease_until IS NULL OR lease_until<=?)",
                    lease,
                    now.plusSeconds(60),
                    now)
                == 1;
    try {
      if (owned)
        storage.visitOlderThan(
            now.minus(Duration.ofHours(24)),
            object -> {
              if (files.get() >= batch) return false;
              if (!dry
                  && db.update(
                          "UPDATE operation_state SET lease_until=? WHERE name='cleanup_uploads' AND lease_id=? AND lease_until>?",
                          clock.instant().plusSeconds(60),
                          lease,
                          clock.instant())
                      != 1) return false;
              if (db.count(
                      "SELECT COUNT(*) FROM stored_files WHERE object_key=? AND storage=?",
                      object.key(),
                      settings.storage().name())
                  != 0) return true;
              if (!dry
                  && db.count("SELECT COUNT(*) FROM stored_files WHERE object_key=?", object.key())
                      == 0) storage.delete(object.key());
              return files.incrementAndGet() < batch;
            });
    } finally {
      if (!dry && owned)
        db.update(
            "UPDATE operation_state SET lease_id=NULL,lease_until=NULL WHERE name='cleanup_uploads' AND lease_id=?",
            lease);
    }
    long audits = 0;
    if (settings.bool("CLEANUP_AUDIT_ENABLED", false)) {
      if (settings.text("CLEANUP_AUDIT_RETENTION_DAYS", "").isBlank())
        throw new IllegalArgumentException("Explicit CLEANUP_AUDIT_RETENTION_DAYS required");
      Instant auditCutoff =
          now.minus(
              Duration.ofDays(settings.integer("CLEANUP_AUDIT_RETENTION_DAYS", 365, 1, 36500)));
      audits =
          Objects.requireNonNull(
              transaction.execute(
                  s -> {
                    var ids =
                        db.query(
                            "SELECT id FROM activity_logs WHERE created_at<? ORDER BY id LIMIT "
                                + batch
                                + " FOR UPDATE SKIP LOCKED",
                            (r, i) -> Db.uuid(r, "id"),
                            auditCutoff);
                    if (!dry) deleteBatch("activity_logs", ids);
                    return (long) ids.size();
                  }));
    }
    metrics
        .counter("backend.cleanup.items", "dry_run", Boolean.toString(dry))
        .increment(families + jobs + files.get() + audits);
    return new Result(families, jobs, files.get(), audits, dry);
  }

  private void deleteBatch(String table, List<UUID> ids) {
    if (!Set.of("refresh_families", "email_jobs", "activity_logs").contains(table))
      throw new IllegalArgumentException("Unknown retention table");
    if (!ids.isEmpty())
      db.update(
          "DELETE FROM "
              + table
              + " WHERE id IN ("
              + String.join(",", Collections.nCopies(ids.size(), "?"))
              + ")",
          ids.toArray());
  }
}
