package com.example.backend;

import static org.junit.jupiter.api.Assertions.*;

import com.example.backend.auth.*;
import com.example.backend.config.Settings;
import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.storage.LocalStorage;
import com.example.backend.platform.time.Zones;
import java.io.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.json.JsonMapper;

class CoreTest {
  @TempDir Path temp;

  private Settings settings(Map<String, String> overrides) {
    var env =
        new MockEnvironment()
            .withProperty("DB_PASSWORD", "test-only-password")
            .withProperty("JWT_SECRET", "test-only-secret-32-bytes-minimum-value");
    overrides.forEach(env::withProperty);
    return new Settings(env);
  }

  @Test
  void dotenvQuotingAndRedactedMalformedEntry() throws Exception {
    Files.writeString(
        temp.resolve(".env"),
        "SINGLE='fixture-$-\\'日本'\nDOUBLE=\"fixture\\\\path\\\"quoted\\$literal\"\nLITERAL=RIDHUAN_QUOTED_0\n");
    var env = com.example.backend.config.LocalEnvironment.load(temp);
    assertEquals("fixture-$-'日本", env.get("SINGLE"));
    assertEquals("fixture\\path\"quoted$literal", env.get("DOUBLE"));
    assertEquals("RIDHUAN_QUOTED_0", env.get("LITERAL"));
    Files.writeString(temp.resolve(".env"), "SECRET=\"private-value\n");
    var failure =
        assertThrows(
            IllegalArgumentException.class,
            () -> com.example.backend.config.LocalEnvironment.load(temp));
    assertFalse(failure.toString().contains("private-value"));
  }

  @Test
  void notificationBooleanDefaultsWithoutAcceptingNullOrCoercion() {
    var mapper = JsonMapper.builder().build();
    String fields =
        "\"recipientId\":\"" + UUID.randomUUID() + "\",\"title\":\"title\",\"body\":\"body\"";
    assertFalse(
        mapper
            .readValue(
                "{" + fields + "}", com.example.backend.notifications.NotificationDto.Create.class)
            .sendEmail());
    assertTrue(
        mapper
            .readValue(
                "{" + fields + ",\"sendEmail\":true}",
                com.example.backend.notifications.NotificationDto.Create.class)
            .sendEmail());
    for (String invalid : List.of("null", "\"true\"", "1"))
      assertThrows(
          RuntimeException.class,
          () ->
              mapper.readValue(
                  "{" + fields + ",\"sendEmail\":" + invalid + "}",
                  com.example.backend.notifications.NotificationDto.Create.class));
  }

  @Test
  void passwordsAndHash() {
    assertEquals("a@example.com", Passwords.email(" A@EXAMPLE.COM "));
    assertThrows(RuntimeException.class, () -> Passwords.validate("日本語".repeat(9)));
    assertDoesNotThrow(() -> Passwords.validate("a".repeat(72)));
    assertEquals(64, AuthService.hash("opaque").length());
    assertNotEquals(AuthService.hash("a"), AuthService.hash("b"));
  }

  @Test
  void rejectInvalidConfiguration() {
    assertThrows(IllegalArgumentException.class, () -> settings(Map.of("DB_PROVIDER", "sqlite")));
    assertThrows(IllegalArgumentException.class, () -> settings(Map.of("CACHE_ENABLED", "1")));
    assertThrows(IllegalArgumentException.class, () -> settings(Map.of("APP_INSTANCE_COUNT", "2")));
    assertThrows(IllegalArgumentException.class, () -> settings(Map.of("DB_NAME", "bad;sql")));
    assertThrows(
        IllegalArgumentException.class,
        () -> settings(Map.of("APP_ENV", "production", "ADMIN_PASSWORD", "change-me")));
  }

  @Test
  void endpointOverrides() throws Exception {
    var mapper = JsonMapper.builder().build();
    assertEquals(
        EndpointId.values().length, new EndpointRegistry(settings(Map.of()), mapper).all().size());
    for (String invalid :
        List.of(
            "{\"unknown\":{}}",
            "{\"health.get\":{\"audit\":\"required\"}}",
            "{\"auth.login\":{\"cache\":\"read\"}}",
            "{\"notification.stream\":{\"cache\":\"read\"}}",
            "{\"auth.login\":{\"unknown\":true}}"))
      assertThrows(
          RuntimeException.class,
          () -> new EndpointRegistry(settings(Map.of("ENDPOINT_POLICIES_JSON", invalid)), mapper));
  }

  @Test
  void localStorageOwnsPaths() throws Exception {
    var storage = new LocalStorage(settings(Map.of("UPLOAD_DIR", temp.toString())));
    String key = UUID.randomUUID().toString();
    storage.put(key, new ByteArrayInputStream("data".getBytes()), 4, "text/plain");
    try (var input = storage.open(key)) {
      assertEquals("data", new String(input.readAllBytes()));
    }
    assertThrows(IOException.class, () -> storage.open("../outside"));
    assertThrows(
        IOException.class,
        () -> storage.put(key, new ByteArrayInputStream(new byte[1]), 1, "text/plain"));
    assertEquals("data", Files.readString(temp.resolve(key)));
    var visited = new ArrayList<String>();
    storage.visitOlderThan(
        Instant.now().plusSeconds(60),
        object -> {
          visited.add(object.key());
          return false;
        });
    assertEquals(List.of(key), visited);
    storage.delete(key);
    assertFalse(Files.exists(temp.resolve(key)));
  }

  @Test
  void timeZonesDoNotChangeStorageInstant() {
    Instant value = Instant.parse("2026-01-01T00:00:00Z");
    assertEquals(7, Zones.present(value, "WIB").getHour());
    assertEquals(8, Zones.present(value, "WITA").getHour());
    assertEquals(9, Zones.present(value, "WIT").getHour());
    assertEquals(value, Zones.present(value, "America/New_York").toInstant());
    assertNotEquals(
        Zones.present(value, "America/New_York").getOffset(),
        Zones.present(Instant.parse("2026-07-01T00:00:00Z"), "America/New_York").getOffset());
  }
}
