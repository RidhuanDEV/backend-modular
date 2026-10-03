package com.example.backend.platform.jobs;

import com.example.backend.config.Settings;
import com.example.backend.platform.observability.Telemetry;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.jspecify.annotations.Nullable;
import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Component;

@Component
public final class Db {
  private final JdbcTemplate jdbc;
  private final Settings settings;
  private final Telemetry telemetry;

  public Db(JdbcTemplate jdbc, Settings settings, Telemetry telemetry) {
    this.jdbc = jdbc;
    this.settings = settings;
    this.telemetry = telemetry;
  }

  public int update(String sql, @Nullable Object... args) {
    return telemetry.observe(
        Telemetry.Operation.jdbc_mutation, () -> jdbc.update(sql, adapt(args)));
  }

  public <T extends @Nullable Object> List<T> query(
      String sql, RowMapper<T> mapper, @Nullable Object... args) {
    return telemetry.observe(
        Telemetry.Operation.jdbc_query, () -> jdbc.query(sql, mapper, adapt(args)));
  }

  public long count(String sql, @Nullable Object... args) {
    Long result =
        telemetry.observe(
            Telemetry.Operation.jdbc_query,
            () -> jdbc.queryForObject(sql, Long.class, adapt(args)));
    return Objects.requireNonNull(result);
  }

  private @Nullable Object[] adapt(@Nullable Object[] args) {
    return Arrays.stream(args)
        .map(
            v ->
                v instanceof UUID uuid && settings.provider() == Settings.Provider.mysql
                    ? uuid.toString()
                    : v instanceof Instant instant ? Timestamp.from(instant) : v)
        .toArray();
  }

  public static UUID uuid(ResultSet row, String field) throws SQLException {
    return UUID.fromString(row.getString(field));
  }

  public static Instant instant(ResultSet row, String field) throws SQLException {
    return Objects.requireNonNull(row.getTimestamp(field)).toInstant();
  }

  public static @Nullable Instant optionalInstant(ResultSet row, String field) throws SQLException {
    Timestamp value = row.getTimestamp(field);
    return value == null ? null : value.toInstant();
  }
}
