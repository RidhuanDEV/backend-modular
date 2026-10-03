package com.example.backend.notifications;

import com.example.backend.config.Settings;
import com.example.backend.platform.audit.AuditService;
import com.example.backend.platform.audit.AuditService.Snapshot;
import com.example.backend.platform.endpoint.EndpointId;
import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.http.RequestContext;
import com.example.backend.platform.jobs.Db;
import com.example.backend.users.UserRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.util.*;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {
  private final Db db;
  private final UserRepository users;
  private final Settings settings;
  private final Clock clock;
  private final AuditService audit;

  public NotificationService(
      Db db, UserRepository users, Settings settings, Clock clock, AuditService audit) {
    this.db = db;
    this.users = users;
    this.settings = settings;
    this.clock = clock;
    this.audit = audit;
  }

  @Transactional
  public NotificationDto.Response create(NotificationDto.Create input, UUID actor) {
    var recipient = users.lock(input.recipientId()).orElseThrow(ApiException::missing);
    if (recipient.deletedAt != null) throw ApiException.missing();
    if (db.count("SELECT COUNT(*) FROM notification_counters WHERE recipient_id=?", recipient.id)
        == 0)
      db.update(
          "INSERT INTO notification_counters(recipient_id,sequence) VALUES(?,0)", recipient.id);
    db.update(
        "UPDATE notification_counters SET sequence=sequence+1 WHERE recipient_id=?", recipient.id);
    long sequence =
        db.count("SELECT sequence FROM notification_counters WHERE recipient_id=?", recipient.id);
    UUID id = UUID.randomUUID();
    var now = clock.instant();
    var status =
        input.sendEmail()
            ? settings.bool("SMTP_ENABLED", false)
                ? NotificationDto.EmailStatus.PENDING
                : NotificationDto.EmailStatus.FAILED
            : NotificationDto.EmailStatus.NOT_REQUESTED;
    db.update(
        "INSERT INTO notifications(id,recipient_id,actor_id,sequence,title,body,email_status,created_at) VALUES(?,?,?,?,?,?,?,?)",
        id,
        recipient.id,
        actor,
        sequence,
        input.title().trim(),
        input.body().trim(),
        status.name(),
        now);
    var requestContext = RequestContext.current();
    var span = io.opentelemetry.api.trace.Span.current().getSpanContext();
    String traceParent =
        span.isValid()
            ? "00-"
                + span.getTraceId()
                + "-"
                + span.getSpanId()
                + "-"
                + span.getTraceFlags().asHex()
            : null;
    if (status == NotificationDto.EmailStatus.PENDING)
      db.update(
          "INSERT INTO email_jobs(id,notification_id,recipient,title,body,status,attempts,available_at,created_at,request_id,trace_parent) VALUES(?,?,?,?,?,'PENDING',0,?,?,?,?)",
          UUID.randomUUID(),
          id,
          recipient.email,
          input.title().trim(),
          input.body().trim(),
          now,
          now,
          requestContext == null ? null : requestContext.requestId(),
          traceParent);
    audit.write(
        EndpointId.NOTIFICATION_CREATE,
        actor,
        "CREATE",
        id,
        null,
        new Snapshot(id, null, null, input.sendEmail(), null));
    return get(id, recipient.id);
  }

  public long cursor(UUID actor, @Nullable UUID cursor) {
    if (cursor == null) return 0;
    var result =
        db.query(
            "SELECT sequence FROM notifications WHERE id=? AND recipient_id=?",
            (r, i) -> r.getLong("sequence"),
            cursor,
            actor);
    if (result.isEmpty()) throw new ApiException(400, "Unknown notification cursor");
    return result.getFirst();
  }

  public NotificationDto.Page list(UUID actor, @Nullable UUID cursor) {
    long sequence = cursor(actor, cursor);
    var rows =
        db.query(
            "SELECT * FROM notifications WHERE recipient_id=? "
                + (cursor == null ? "" : "AND sequence<? ")
                + "ORDER BY sequence DESC LIMIT 51",
            (r, i) -> map(r),
            cursor == null ? new Object[] {actor} : new Object[] {actor, sequence});
    return new NotificationDto.Page(
        rows.stream().limit(50).map(NotificationDto.Item::response).toList(),
        rows.size() > 50 ? rows.get(49).response().id() : null);
  }

  public List<NotificationDto.Item> batch(UUID actor, long after, boolean unreadOnly) {
    var user = users.findById(actor);
    if (user.isEmpty() || user.get().deletedAt != null) throw ApiException.unauthorized();
    return db.query(
        "SELECT * FROM notifications WHERE recipient_id=? AND sequence>? "
            + (unreadOnly ? "AND read_at IS NULL " : "")
            + "ORDER BY sequence ASC LIMIT 50",
        (r, i) -> map(r),
        actor,
        after);
  }

  @Transactional
  public NotificationDto.Response read(UUID id, UUID actor) {
    var before = get(id, actor);
    if (before.readAt() == null)
      db.update(
          "UPDATE notifications SET read_at=? WHERE id=? AND recipient_id=?",
          clock.instant(),
          id,
          actor);
    var after = get(id, actor);
    audit.write(
        EndpointId.NOTIFICATION_READ,
        actor,
        "UPDATE",
        id,
        new Snapshot(id, null, null, null, before.readAt()),
        new Snapshot(id, null, null, null, after.readAt()));
    return after;
  }

  public NotificationDto.Response get(UUID id, UUID actor) {
    var rows =
        db.query(
            "SELECT * FROM notifications WHERE id=? AND recipient_id=?",
            (r, i) -> map(r).response(),
            id,
            actor);
    if (rows.isEmpty()) throw ApiException.missing();
    return rows.getFirst();
  }

  private NotificationDto.Item map(ResultSet r) throws SQLException {
    return new NotificationDto.Item(
        new NotificationDto.Response(
            Db.uuid(r, "id"),
            Db.uuid(r, "recipient_id"),
            r.getString("title"),
            r.getString("body"),
            NotificationDto.EmailStatus.valueOf(r.getString("email_status")),
            Db.optionalInstant(r, "read_at"),
            Db.instant(r, "created_at")),
        r.getLong("sequence"));
  }
}
