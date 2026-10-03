package com.example.backend.platform.audit;

import com.example.backend.config.Settings;
import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.http.RequestContext;
import java.sql.*;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import javax.sql.DataSource;
import org.jspecify.annotations.Nullable;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

@Service
public class AuditService {
  @com.fasterxml.jackson.annotation.JsonInclude(
      com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
  public record Snapshot(
      @Nullable UUID id,
      @Nullable UUID roleId,
      @Nullable String name,
      @Nullable Boolean emailRequested,
      @Nullable Instant readAt,
      java.util.@Nullable List<UUID> permissionIds) {
    public Snapshot(
        @Nullable UUID id,
        @Nullable UUID roleId,
        @Nullable String name,
        @Nullable Boolean emailRequested,
        @Nullable Instant readAt) {
      this(id, roleId, name, emailRequested, readAt, null);
    }
  }

  private final DataSource source;
  private final EndpointRegistry registry;
  private final ObjectMapper mapper;
  private final Clock clock;
  private final Settings settings;

  public AuditService(
      DataSource source,
      EndpointRegistry registry,
      ObjectMapper mapper,
      Clock clock,
      Settings settings) {
    this.source = source;
    this.registry = registry;
    this.mapper = mapper;
    this.clock = clock;
    this.settings = settings;
  }

  public void write(
      EndpointId id,
      @Nullable UUID actor,
      String behavior,
      @Nullable UUID entity,
      @Nullable Snapshot before,
      @Nullable Snapshot after) {
    var context = RequestContext.current();
    var mode = registry.get(id).audit();
    if (mode == EndpointRegistry.Audit.none) return;
    if (!TransactionSynchronizationManager.isActualTransactionActive())
      throw new IllegalStateException("Audit requires business transaction");
    Connection connection = DataSourceUtils.getConnection(source);
    Savepoint savepoint = null;
    try {
      if (mode == EndpointRegistry.Audit.optional) savepoint = connection.setSavepoint();
      String json =
          settings.provider() == Settings.Provider.postgresql
              ? "CAST(? AS jsonb)"
              : "CAST(? AS JSON)";
      try (PreparedStatement statement =
          connection.prepareStatement(
              "INSERT INTO activity_logs(id,user_id,actor_id_snapshot,behavior,module,entity_id,before_snapshot,after_snapshot,request_id,endpoint_id,created_at) VALUES(?,?,?,?,?,?,"
                  + json
                  + ","
                  + json
                  + ",?,?,?)")) {
        statement.setObject(1, db(UUID.randomUUID()));
        statement.setObject(2, db(actor));
        statement.setString(3, actor == null ? null : actor.toString());
        statement.setString(4, behavior);
        statement.setString(5, registry.get(id).module());
        statement.setObject(6, db(entity));
        statement.setString(7, before == null ? null : mapper.writeValueAsString(before));
        statement.setString(8, after == null ? null : mapper.writeValueAsString(after));
        statement.setString(9, context == null ? null : context.requestId());
        statement.setString(10, id.wire());
        statement.setTimestamp(11, Timestamp.from(clock.instant()));
        statement.executeUpdate();
      }
      if (savepoint != null) connection.releaseSavepoint(savepoint);
    } catch (Exception failure) {
      if (mode == EndpointRegistry.Audit.required)
        throw new IllegalStateException("Required audit failed", failure);
      try {
        if (savepoint == null) throw new IllegalStateException("Audit savepoint unavailable");
        connection.rollback(savepoint);
        connection.releaseSavepoint(savepoint);
      } catch (SQLException rollback) {
        throw new IllegalStateException("Audit rollback failed", rollback);
      }
      org.slf4j.LoggerFactory.getLogger(getClass())
          .warn("optional_audit_failed endpoint={}", id.wire());
    } finally {
      DataSourceUtils.releaseConnection(connection, source);
    }
  }

  private @Nullable Object db(@Nullable UUID id) {
    return id == null ? null : settings.provider() == Settings.Provider.mysql ? id.toString() : id;
  }
}
