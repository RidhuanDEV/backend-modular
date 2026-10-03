package com.example.backend.platform.storage;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.example.backend.config.Settings;
import java.io.ByteArrayInputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.env.MockEnvironment;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.paginators.ListObjectsV2Iterable;

class StorageScopeTest {
  private Settings settings(String prefix) {
    return new Settings(
        new MockEnvironment()
            .withProperty("DB_PASSWORD", "fixture-password")
            .withProperty("JWT_SECRET", "fixture-secret-with-32-byte-minimum-value")
            .withProperty("S3_BUCKET", "fixture-bucket")
            .withProperty("S3_PREFIX", prefix));
  }

  @Test
  void externalRequestsAndCleanupAreScoped() throws Exception {
    S3Client client = mock(S3Client.class);
    try (var storage = new S3Storage(settings("owner"), client)) {
      String id = UUID.randomUUID().toString(), second = UUID.randomUUID().toString();
      storage.put(id, new ByteArrayInputStream(new byte[] {1}), 1, "text/plain");
      var put = ArgumentCaptor.forClass(PutObjectRequest.class);
      verify(client).putObject(put.capture(), any(RequestBody.class));
      assertEquals("owner/" + id, put.getValue().key());
      assertEquals("*", put.getValue().ifNoneMatch());
      assertThrows(IllegalArgumentException.class, () -> storage.delete("-".repeat(36)));
      assertThrows(IllegalArgumentException.class, () -> storage.delete("../" + id));
      Instant old = Instant.parse("2020-01-01T00:00:00Z");
      when(client.listObjectsV2(any(ListObjectsV2Request.class)))
          .thenReturn(
              ListObjectsV2Response.builder()
                  .isTruncated(false)
                  .contents(
                      S3Object.builder().key("other/" + id).lastModified(old).build(),
                      S3Object.builder().key("owner/" + "-".repeat(36)).lastModified(old).build(),
                      S3Object.builder().key("owner/" + id).lastModified(old).build(),
                      S3Object.builder().key("owner/" + second).lastModified(old).build())
                  .build());
      when(client.listObjectsV2Paginator(any(ListObjectsV2Request.class)))
          .thenAnswer(
              invocation ->
                  new ListObjectsV2Iterable(
                      client, invocation.getArgument(0, ListObjectsV2Request.class)));
      var seen = new ArrayList<String>();
      storage.visitOlderThan(
          Instant.now(),
          object -> {
            seen.add(object.key());
            return false;
          });
      assertEquals(java.util.List.of(id), seen);
      var listing = ArgumentCaptor.forClass(ListObjectsV2Request.class);
      verify(client).listObjectsV2Paginator(listing.capture());
      assertEquals("owner/", listing.getValue().prefix());
    }
  }

  @Test
  void invalidNamespaceFailsBeforeExternalWork() {
    assertThrows(IllegalArgumentException.class, () -> settings("../foreign"));
    assertFalse(ObjectStorage.validKey("-".repeat(36)));
  }
}
