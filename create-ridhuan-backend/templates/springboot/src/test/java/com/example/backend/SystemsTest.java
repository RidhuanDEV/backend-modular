package com.example.backend;

import static org.junit.jupiter.api.Assertions.*;

import com.example.backend.auth.*;
import com.example.backend.notifications.*;
import com.example.backend.operations.*;
import com.example.backend.platform.jobs.Db;
import com.example.backend.platform.mail.EmailJobs;
import com.example.backend.users.UserRepository;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.context.annotation.*;
import org.springframework.core.env.MapPropertySource;
import org.testcontainers.containers.JdbcDatabaseContainer;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;

class SystemsTest {
  static final class MutableClock extends Clock {
    private final AtomicReference<Instant> now =
        new AtomicReference<>(Instant.parse("2026-01-01T00:00:00Z"));

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      if (!zone.equals(ZoneOffset.UTC)) throw new IllegalArgumentException("UTC clock");
      return this;
    }

    @Override
    public Instant instant() {
      return now.get();
    }

    void advance(long seconds) {
      now.updateAndGet(v -> v.plusSeconds(seconds));
    }
  }

  @Configuration
  static class FixtureConfiguration {
    @Bean
    @Primary
    MutableClock fixtureClock() {
      return new MutableClock();
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"postgresql", "mysql"})
  void sessionsWorkerRetention(String provider) throws Exception {
    java.nio.file.Path uploads = java.nio.file.Files.createTempDirectory("spring-system-uploads-");
    try (JdbcDatabaseContainer<?> container =
        provider.equals("mysql")
            ? new MySQLContainer("mysql:8.4")
            : new PostgreSQLContainer("postgres:18")) {
      container.withLabel(
          "ridhuan.test.owner",
          Objects.requireNonNullElse(
              System.getenv("SPRING_TEST_OWNER"), "spring-native-" + UUID.randomUUID()));
      container.start();
      Flyway.configure()
          .dataSource(container.getJdbcUrl(), container.getUsername(), container.getPassword())
          .locations("classpath:db/migration/" + provider)
          .load()
          .migrate();
      var app = new SpringApplication(BackendApplication.class, FixtureConfiguration.class);
      app.setWebApplicationType(WebApplicationType.NONE);
      try (var context =
          app.run(
              "--app.mode=email-worker",
              "--DB_PROVIDER=" + provider,
              "--spring.profiles.active=" + provider,
              "--spring.datasource.url=" + container.getJdbcUrl(),
              "--spring.datasource.username=" + container.getUsername(),
              "--spring.datasource.password=" + container.getPassword(),
              "--DB_PASSWORD=" + container.getPassword(),
              "--DB_USER=" + container.getUsername(),
              "--JWT_SECRET=fixture-native-jwt-32-byte-secret-only",
              "--ADMIN_PASSWORD=fixture-admin-password",
              "--SMTP_ENABLED=false",
              "--UPLOAD_DIR=" + uploads,
              "--spring.main.banner-mode=off")) {
        var seed = context.getBean(SeedService.class);
        seed.seed();
        var users = context.getBean(UserRepository.class);
        var admin = users.findByEmail("admin@example.com").orElseThrow();
        // A permission created after seeding reaches every permission-managing role (pure RBAC).
        var access = context.getBean(com.example.backend.platform.security.Access.class);
        var fixtureDb = context.getBean(Db.class);
        UUID invoices = UUID.randomUUID(), billing = UUID.randomUUID();
        fixtureDb.update(
            "INSERT INTO permissions(id,name,created_at,updated_at) VALUES(?,?,?,?)",
            invoices,
            "manage_invoices",
            java.time.Instant.now(),
            java.time.Instant.now());
        fixtureDb.update(
            "INSERT INTO roles(id,name,created_at,updated_at) VALUES(?,?,?,?)",
            billing,
            "BILLING",
            java.time.Instant.now(),
            java.time.Instant.now());
        fixtureDb.update(
            "INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)", billing, invoices);
        assertThrows(
            com.example.backend.platform.http.ApiException.class,
            () -> access.grant(admin.id, List.of(invoices)));
        access.grantToPermissionManagers(invoices);
        assertDoesNotThrow(() -> access.grant(admin.id, List.of(invoices)));
        assertDoesNotThrow(() -> access.within(admin.id, billing));
        String passwordHash = admin.password;
        seed.seed();
        assertEquals(passwordHash, users.findByEmail(admin.email).orElseThrow().password);
        var auth = context.getBean(AuthService.class);
        var db = context.getBean(Db.class);
        var clock = context.getBean(MutableClock.class);
        var jobs = context.getBean(EmailJobs.class);
        var notifications = context.getBean(NotificationService.class);
        AuthDto.Tokens
            original = auth.login(new AuthDto.Login(admin.email, "fixture-admin-password")),
            current = original;
        // Rotations inside the 30-day idle window succeed until the 90-day absolute cap.
        for (int month = 0; month < 3; month++) {
          clock.advance(29 * 86400L);
          current = auth.refresh(new AuthDto.Refresh(current.refreshToken()));
        }
        clock.advance(29 * 86400L);
        AuthDto.Tokens capped = current;
        assertThrows(
            RuntimeException.class, () -> auth.refresh(new AuthDto.Refresh(capped.refreshToken())));
        assertEquals(1, db.count("SELECT COUNT(*) FROM refresh_families"));
        assertEquals(4, db.count("SELECT COUNT(*) FROM refresh_tokens"));
        AuthDto.Tokens latest = current;
        assertThrows(
            RuntimeException.class,
            () -> auth.refresh(new AuthDto.Refresh(original.refreshToken())));
        assertThrows(
            RuntimeException.class, () -> auth.refresh(new AuthDto.Refresh(latest.refreshToken())));
        var pair = auth.login(new AuthDto.Login(admin.email, "fixture-admin-password"));
        var pool = Executors.newFixedThreadPool(3);
        try {
          List<Callable<Boolean>> calls =
              List.of(
                  () -> {
                    try {
                      auth.refresh(new AuthDto.Refresh(pair.refreshToken()));
                      return true;
                    } catch (RuntimeException e) {
                      return false;
                    }
                  },
                  () -> {
                    auth.logout(new AuthDto.Refresh(pair.refreshToken()));
                    return true;
                  },
                  () -> {
                    try {
                      auth.refresh(new AuthDto.Refresh(pair.refreshToken()));
                      return true;
                    } catch (RuntimeException e) {
                      return false;
                    }
                  });
          for (var future : pool.invokeAll(calls, 15, TimeUnit.SECONDS))
            assertFalse(future.isCancelled());
        } finally {
          pool.shutdownNow();
        }
        // The capped family is expired rather than revoked; none may remain usable.
        assertEquals(
            0,
            db.count(
                "SELECT COUNT(*) FROM refresh_families WHERE revoked_at IS NULL AND expires_at > ?",
                clock.instant()));
        var note =
            notifications.create(
                new NotificationDto.Create(admin.id, "worker", "immutable", false), admin.id);
        UUID job = UUID.randomUUID();
        db.update(
            "INSERT INTO email_jobs(id,notification_id,recipient,title,body,status,attempts,available_at,created_at) VALUES(?,?,?,?,?,'PENDING',0,?,?)",
            job,
            note.id(),
            admin.email,
            "snapshot",
            "immutable",
            clock.instant(),
            clock.instant());
        var first = Objects.requireNonNull(jobs.claim());
        assertNull(jobs.claim());
        clock.advance(31);
        assertTrue(jobs.renew(first));
        clock.advance(61);
        var second = Objects.requireNonNull(jobs.claim());
        assertNotEquals(first.leaseId(), second.leaseId());
        assertFalse(jobs.finish(first, true));
        assertTrue(jobs.finish(second, false));
        assertNull(jobs.claim());
        clock.advance(30);
        var third = Objects.requireNonNull(jobs.claim());
        assertEquals(3, third.attempts());
        assertTrue(jobs.finish(third, false));
        clock.advance(120);
        var fourth = Objects.requireNonNull(jobs.claim());
        assertEquals(4, fourth.attempts());
        assertTrue(jobs.finish(fourth, false));
        clock.advance(600);
        var fifth = Objects.requireNonNull(jobs.claim());
        assertEquals(5, fifth.attempts());
        clock.advance(61);
        assertNull(jobs.claim());
        assertEquals(
            1, db.count("SELECT COUNT(*) FROM email_jobs WHERE id=? AND status='FAILED'", job));
        assertEquals(
            NotificationDto.EmailStatus.FAILED,
            notifications.get(note.id(), admin.id).emailStatus());
        var active = auth.login(new AuthDto.Login(admin.email, "fixture-admin-password"));
        var activeRotated = auth.refresh(new AuthDto.Refresh(active.refreshToken()));
        clock.advance(20 * 86400L);
        activeRotated = auth.refresh(new AuthDto.Refresh(activeRotated.refreshToken()));
        clock.advance(20 * 86400L);
        activeRotated = auth.refresh(new AuthDto.Refresh(activeRotated.refreshToken()));
        var cleanup = context.getBean(CleanupService.class);
        var storage = context.getBean(com.example.backend.platform.storage.ObjectStorage.class);
        UUID orphan = UUID.randomUUID(), referenced = UUID.randomUUID(), young = UUID.randomUUID();
        for (UUID id : List.of(orphan, referenced, young)) {
          storage.put(
              id.toString(), new java.io.ByteArrayInputStream(new byte[] {1}), 1, "text/plain");
          java.nio.file.Files.setLastModifiedTime(
              uploads.resolve(id.toString()),
              java.nio.file.attribute.FileTime.from(
                  clock.instant().minusSeconds(id.equals(young) ? 3600 : 25 * 3600)));
        }
        context
            .getBean(com.example.backend.uploads.UploadPersistence.class)
            .insert(
                new com.example.backend.uploads.UploadDto(
                    referenced, "reference", "text/plain", 1, clock.instant()),
                admin.id);
        long tokens = db.count("SELECT COUNT(*) FROM refresh_tokens");
        assertEquals(1, cleanup.run().files());
        assertTrue(java.nio.file.Files.exists(uploads.resolve(orphan.toString())));
        assertEquals(tokens, db.count("SELECT COUNT(*) FROM refresh_tokens"));
        context
            .getEnvironment()
            .getPropertySources()
            .addFirst(new MapPropertySource("fixture-cleanup", Map.of("CLEANUP_DRY_RUN", "false")));
        cleanup.run();
        assertFalse(java.nio.file.Files.exists(uploads.resolve(orphan.toString())));
        assertTrue(java.nio.file.Files.exists(uploads.resolve(referenced.toString())));
        assertTrue(java.nio.file.Files.exists(uploads.resolve(young.toString())));
        assertEquals(1, db.count("SELECT COUNT(*) FROM refresh_families"));
        assertTrue(db.count("SELECT COUNT(*) FROM refresh_tokens") >= 4);
        assertEquals(1, db.count("SELECT COUNT(*) FROM notifications"));
        assertEquals(0, db.count("SELECT COUNT(*) FROM email_jobs"));
        var last = activeRotated;
        assertDoesNotThrow(() -> auth.refresh(new AuthDto.Refresh(last.refreshToken())));
        // Terminal retention must not delete a pending delivery or its persisted notification.
        db.update(
            "INSERT INTO email_jobs(id,notification_id,recipient,title,body,status,attempts,available_at,created_at) VALUES(?,?,?,?,?,'PENDING',0,?,?)",
            UUID.randomUUID(),
            note.id(),
            admin.email,
            "pending",
            "immutable",
            clock.instant().plusSeconds(3600),
            clock.instant().minus(Duration.ofDays(400)));
        for (int i = 0; i < 501; i++)
          db.update(
              "INSERT INTO activity_logs(id,behavior,module,created_at) VALUES(?,'fixture','fixture',?)",
              UUID.randomUUID(),
              clock.instant().minus(Duration.ofDays(400)));
        cleanup.run();
        assertEquals(501, db.count("SELECT COUNT(*) FROM activity_logs WHERE module='fixture'"));
        assertEquals(1, db.count("SELECT COUNT(*) FROM email_jobs WHERE status='PENDING'"));
        context
            .getEnvironment()
            .getPropertySources()
            .addFirst(
                new MapPropertySource(
                    "fixture-audit-retention",
                    Map.of(
                        "CLEANUP_AUDIT_ENABLED",
                        "true",
                        "CLEANUP_AUDIT_RETENTION_DAYS",
                        "365",
                        "CLEANUP_DRY_RUN",
                        "true")));
        assertEquals(500, cleanup.run().audits());
        assertEquals(501, db.count("SELECT COUNT(*) FROM activity_logs WHERE module='fixture'"));
        context
            .getEnvironment()
            .getPropertySources()
            .addFirst(
                new MapPropertySource("fixture-audit-apply", Map.of("CLEANUP_DRY_RUN", "false")));
        var cleaners = Executors.newFixedThreadPool(2);
        try {
          var completed =
              cleaners.invokeAll(
                  List.<Callable<CleanupService.Result>>of(cleanup::run, cleanup::run),
                  15,
                  TimeUnit.SECONDS);
          long deleted = 0;
          for (var result : completed) {
            assertFalse(result.isCancelled());
            var count = result.get().audits();
            assertTrue(count <= 500);
            deleted += count;
          }
          // MySQL may lock scanned rows beyond LIMIT during ordering; a competing
          // SKIP LOCKED batch may legitimately return zero until that transaction commits.
          assertTrue(deleted >= 500 && deleted <= 501);
          assertEquals(
              501 - deleted, db.count("SELECT COUNT(*) FROM activity_logs WHERE module='fixture'"));
          assertEquals(501 - deleted, cleanup.run().audits());
        } finally {
          cleaners.shutdownNow();
        }
        assertEquals(0, db.count("SELECT COUNT(*) FROM activity_logs WHERE module='fixture'"));
        assertEquals(1, db.count("SELECT COUNT(*) FROM email_jobs WHERE status='PENDING'"));
        assertEquals(1, db.count("SELECT COUNT(*) FROM notifications"));
        systemPrimitivesLastRootSessionsAndFileOwnership(context, admin.id);
      }
    } finally {
      try (var files = java.nio.file.Files.walk(uploads)) {
        for (var path : files.sorted(java.util.Comparator.reverseOrder()).toList())
          java.nio.file.Files.deleteIfExists(path);
      }
    }
  }

  private static void actAs(UUID user) {
    org.springframework.security.core.context.SecurityContextHolder.getContext()
        .setAuthentication(
            new org.springframework.security.oauth2.server.resource.authentication
                .JwtAuthenticationToken(
                org.springframework.security.oauth2.jwt.Jwt.withTokenValue("fixture")
                    .header("alg", "none")
                    .subject(user.toString())
                    .build()));
  }

  private static int status(org.junit.jupiter.api.function.Executable call) {
    return assertThrows(com.example.backend.platform.http.ApiException.class, call).status();
  }

  private static void systemPrimitivesLastRootSessionsAndFileOwnership(
      org.springframework.context.ConfigurableApplicationContext context, UUID admin)
      throws Exception {
    var permissions = context.getBean(com.example.backend.permissions.PermissionService.class);
    var permissionRows =
        context.getBean(com.example.backend.permissions.PermissionRepository.class);
    var roles = context.getBean(com.example.backend.roles.RoleService.class);
    var roleRows = context.getBean(com.example.backend.roles.RoleRepository.class);
    var users = context.getBean(com.example.backend.users.UserService.class);
    var auth = context.getBean(AuthService.class);
    var uploads = context.getBean(com.example.backend.uploads.UploadService.class);
    var stored = context.getBean(com.example.backend.uploads.UploadPersistence.class);
    var clock = context.getBean(MutableClock.class);
    try {
      actAs(admin);
      UUID system = permissionRows.findByName("manage_users").orElseThrow().id;
      UUID uploadsPermission = permissionRows.findByName("manage_uploads").orElseThrow().id;
      // System permissions and roles are immutable and their names reserved.
      assertEquals(
          403,
          status(
              () ->
                  permissions.update(
                      system, new com.example.backend.permissions.PermissionDto.Update("x"))));
      assertEquals(403, status(() -> permissions.delete(system)));
      UUID custom =
          permissions
              .create(new com.example.backend.permissions.PermissionDto.Create("custom_access"))
              .id();
      // RBAC only: a new permission is granted to every role managing permissions.
      assertEquals(
          1,
          context
              .getBean(Db.class)
              .count(
                  "SELECT COUNT(*) FROM role_permissions rp JOIN roles r ON r.id=rp.role_id"
                      + " WHERE r.name='ADMIN' AND rp.permission_id=?",
                  custom));
      assertEquals(
          403,
          status(
              () ->
                  permissions.update(
                      custom,
                      new com.example.backend.permissions.PermissionDto.Update("manage_users"))));
      assertDoesNotThrow(
          () ->
              permissions.update(
                  custom,
                  new com.example.backend.permissions.PermissionDto.Update("custom_renamed")));
      UUID userRole = roleRows.findByName("USER").orElseThrow().id;
      UUID adminRole = roleRows.findByName("ADMIN").orElseThrow().id;
      assertEquals(
          403,
          status(() -> roles.update(userRole, new com.example.backend.roles.RoleDto.Update("x"))));
      assertEquals(403, status(() -> roles.delete(userRole)));
      assertEquals(
          403, status(() -> roles.create(new com.example.backend.roles.RoleDto.Create("admin"))));
      // System permissions must keep an active holder.
      assertEquals(
          403,
          status(
              () ->
                  roles.assign(
                      adminRole, new com.example.backend.roles.RoleDto.Assign(List.of(custom)))));
      UUID uploader = roles.create(new com.example.backend.roles.RoleDto.Create("uploader")).id();
      roles.assign(
          uploader, new com.example.backend.roles.RoleDto.Assign(List.of(uploadsPermission)));
      // A role change revokes every refresh session of that user.
      UUID member =
          auth.register(new AuthDto.Register("uploader@example.com", "member-password")).id();
      var tokens = auth.login(new AuthDto.Login("uploader@example.com", "member-password"));
      users.update(member, new com.example.backend.users.UserDto.Update(null, uploader));
      assertThrows(
          RuntimeException.class, () -> auth.refresh(new AuthDto.Refresh(tokens.refreshToken())));
      // Files are readable by their uploader and admin users only.
      UUID file = UUID.randomUUID();
      stored.insert(
          new com.example.backend.uploads.UploadDto(
              file, "private.pdf", "application/pdf", 1, clock.instant()),
          admin);
      actAs(member);
      assertEquals(404, status(() -> uploads.get(file, member)));
      assertEquals(
          404,
          status(() -> uploads.download(file, member, java.io.OutputStream.nullOutputStream())));
      actAs(admin);
      assertEquals(file, uploads.get(file, admin).id());
      // The only holder of the system permissions cannot be demoted.
      assertEquals(
          403,
          status(
              () ->
                  users.update(
                      admin, new com.example.backend.users.UserDto.Update(null, userRole))));
    } finally {
      org.springframework.security.core.context.SecurityContextHolder.clearContext();
    }
  }
}
