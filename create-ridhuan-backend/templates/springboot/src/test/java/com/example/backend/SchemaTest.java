package com.example.backend;

import static org.junit.jupiter.api.Assertions.*;

import java.sql.*;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.testcontainers.containers.JdbcDatabaseContainer;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;

class SchemaTest {
  @ParameterizedTest
  @ValueSource(strings = {"postgresql", "mysql"})
  void nativeUpgradePreservesData(String provider) throws Exception {
    try (JdbcDatabaseContainer<?> container =
        provider.equals("mysql")
            ? new MySQLContainer("mysql:8.4")
            : new PostgreSQLContainer("postgres:18")) {
      container.withLabel(
          "ridhuan.test.owner",
          Objects.requireNonNullElse(
              System.getenv("SPRING_TEST_OWNER"), "spring-native-" + UUID.randomUUID()));
      container.start();
      var first =
          Flyway.configure()
              .dataSource(container.getJdbcUrl(), container.getUsername(), container.getPassword())
              .locations("classpath:db/migration/" + provider)
              .target("1")
              .load();
      first.migrate();
      UUID role = UUID.randomUUID(), user = UUID.randomUUID();
      try (var connection =
          DriverManager.getConnection(
              container.getJdbcUrl(), container.getUsername(), container.getPassword())) {
        try (var statement =
            connection.prepareStatement(
                "INSERT INTO roles(id,name,created_at,updated_at) VALUES(?,?,?,?)")) {
          statement.setObject(1, provider.equals("mysql") ? role.toString() : role);
          statement.setString(2, "fixture");
          statement.setTimestamp(3, Timestamp.from(Instant.now()));
          statement.setTimestamp(4, Timestamp.from(Instant.now()));
          statement.executeUpdate();
        }
        try (var statement =
            connection.prepareStatement(
                "INSERT INTO app_users(id,email,password,role_id,created_at,updated_at) VALUES(?,?,?,?,?,?)")) {
          statement.setObject(1, provider.equals("mysql") ? user.toString() : user);
          statement.setString(2, "fixture@example.com");
          statement.setString(3, "unchanged-hash");
          statement.setObject(4, provider.equals("mysql") ? role.toString() : role);
          statement.setTimestamp(5, Timestamp.from(Instant.now()));
          statement.setTimestamp(6, Timestamp.from(Instant.now()));
          statement.executeUpdate();
        }
      }
      var current =
          Flyway.configure()
              .dataSource(container.getJdbcUrl(), container.getUsername(), container.getPassword())
              .locations("classpath:db/migration/" + provider)
              .load();
      assertEquals(3, current.migrate().migrationsExecuted);
      assertEquals(0, current.migrate().migrationsExecuted);
      current.validate();
      try (var connection =
              DriverManager.getConnection(
                  container.getJdbcUrl(), container.getUsername(), container.getPassword());
          var statement = connection.createStatement()) {
        try (var rows = statement.executeQuery("SELECT password FROM app_users")) {
          assertTrue(rows.next());
          assertEquals("unchanged-hash", rows.getString(1));
        }
        assertThrows(SQLException.class, () -> statement.executeUpdate("DELETE FROM roles"));
        for (String table :
            new String[] {
              "refresh_families",
              "refresh_tokens",
              "notification_counters",
              "notifications",
              "email_jobs",
              "activity_logs",
              "stored_files"
            })
          try (var rows = statement.executeQuery("SELECT COUNT(*) FROM " + table)) {
            assertTrue(rows.next());
            assertEquals(0, rows.getLong(1));
          }
      }
    }
  }
}
