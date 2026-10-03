package com.example.backend.platform.mail;

import com.example.backend.config.Settings;
import com.example.backend.platform.jobs.Db;
import java.time.*;
import java.util.*;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EmailJobs {
  public record Claim(
      UUID id,
      UUID notificationId,
      UUID leaseId,
      String recipient,
      String title,
      String body,
      int attempts,
      @Nullable String requestId,
      @Nullable String traceParent) {}

  private final Db db;
  private final Clock clock;
  private final Settings settings;

  public EmailJobs(Db db, Clock clock, Settings settings) {
    this.db = db;
    this.clock = clock;
    this.settings = settings;
  }

  @Transactional
  public @Nullable Claim claim() {
    Instant now = clock.instant();
    var jobs =
        db.query(
            "SELECT * FROM email_jobs WHERE (status='PENDING' AND available_at<=?) OR (status='LEASED' AND lease_until<=?) ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
            (r, i) ->
                new Claim(
                    Db.uuid(r, "id"),
                    Db.uuid(r, "notification_id"),
                    UUID.randomUUID(),
                    r.getString("recipient"),
                    r.getString("title"),
                    r.getString("body"),
                    r.getInt("attempts"),
                    r.getString("request_id"),
                    r.getString("trace_parent")),
            now,
            now);
    if (jobs.isEmpty()) return null;
    Claim prior = jobs.getFirst();
    if (prior.attempts() >= 5) {
      db.update(
          "UPDATE email_jobs SET status='FAILED',completed_at=?,lease_id=NULL,lease_until=NULL WHERE id=?",
          now,
          prior.id());
      db.update(
          "UPDATE notifications SET email_status='FAILED' WHERE id=?", prior.notificationId());
      return null;
    }
    Claim claim =
        new Claim(
            prior.id(),
            prior.notificationId(),
            prior.leaseId(),
            prior.recipient(),
            prior.title(),
            prior.body(),
            prior.attempts() + 1,
            prior.requestId(),
            prior.traceParent());
    db.update(
        "UPDATE email_jobs SET status='LEASED',attempts=attempts+1,lease_id=?,lease_until=? WHERE id=?",
        claim.leaseId(),
        now.plus(settings.seconds("EMAIL_LEASE_SECONDS", 60)),
        claim.id());
    return claim;
  }

  @Transactional
  public boolean renew(Claim claim) {
    return db.update(
            "UPDATE email_jobs SET lease_until=? WHERE id=? AND lease_id=? AND status='LEASED' AND lease_until>?",
            clock.instant().plus(settings.seconds("EMAIL_LEASE_SECONDS", 60)),
            claim.id(),
            claim.leaseId(),
            clock.instant())
        == 1;
  }

  @Transactional
  public boolean finish(Claim claim, boolean sent) {
    Instant now = clock.instant();
    boolean terminal = sent || claim.attempts() >= 5;
    String status = sent ? "SENT" : terminal ? "FAILED" : "PENDING";
    long[] delays = {5, 30, 120, 600};
    Instant available = now.plusSeconds(delays[Math.min(claim.attempts() - 1, 3)]);
    int changed =
        db.update(
            "UPDATE email_jobs SET status=?,available_at=?,completed_at=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=? AND status='LEASED' AND lease_until>?",
            status,
            available,
            terminal ? now : null,
            claim.id(),
            claim.leaseId(),
            now);
    if (changed == 1 && terminal)
      db.update(
          "UPDATE notifications SET email_status=? WHERE id=?", status, claim.notificationId());
    return changed == 1;
  }
}
