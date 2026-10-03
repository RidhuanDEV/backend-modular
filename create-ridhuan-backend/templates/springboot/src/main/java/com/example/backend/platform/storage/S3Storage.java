package com.example.backend.platform.storage;

import com.example.backend.config.Settings;
import java.io.*;
import java.time.*;
import java.util.*;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

public final class S3Storage implements ObjectStorage, AutoCloseable {
  private final S3Client client;
  private final String bucket;
  private final String prefix;

  public S3Storage(Settings s) {
    this(s, createClient(s));
  }

  S3Storage(Settings s, S3Client client) {
    bucket = s.text("S3_BUCKET", "uploads");
    prefix = s.s3Prefix() + "/";
    this.client = client;
  }

  private static S3Client createClient(Settings s) {
    if (s.text("S3_ACCESS_KEY_ID", "").isBlank() || s.text("S3_SECRET_ACCESS_KEY", "").isBlank())
      throw new IllegalArgumentException("Invalid S3 credentials settings");
    return S3Client.builder()
        .endpointOverride(s.uri("S3_ENDPOINT", "http://localhost:9000"))
        .region(Region.of(s.text("S3_REGION", "us-east-1")))
        .credentialsProvider(
            StaticCredentialsProvider.create(
                AwsBasicCredentials.create(
                    s.text("S3_ACCESS_KEY_ID", ""), s.text("S3_SECRET_ACCESS_KEY", ""))))
        .forcePathStyle(true)
        .httpClientBuilder(
            UrlConnectionHttpClient.builder()
                .connectionTimeout(Duration.ofSeconds(3))
                .socketTimeout(Duration.ofSeconds(15)))
        .overrideConfiguration(
            c ->
                c.apiCallTimeout(Duration.ofSeconds(25))
                    .apiCallAttemptTimeout(Duration.ofSeconds(20)))
        .build();
  }

  private String key(String value) {
    if (!ObjectStorage.validKey(value)) throw new IllegalArgumentException("Invalid storage key");
    return prefix + value;
  }

  @Override
  public void put(String k, InputStream input, long size, String mime) {
    client.putObject(
        PutObjectRequest.builder()
            .bucket(bucket)
            .key(key(k))
            .contentType(mime)
            .ifNoneMatch("*")
            .build(),
        RequestBody.fromInputStream(input, size));
  }

  @Override
  public InputStream open(String k) {
    return client.getObject(GetObjectRequest.builder().bucket(bucket).key(key(k)).build());
  }

  @Override
  public void delete(String k) {
    client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key(k)).build());
  }

  @Override
  public void visitOlderThan(Instant before, Visitor visitor) throws java.io.IOException {
    for (var page :
        client.listObjectsV2Paginator(
            ListObjectsV2Request.builder().bucket(bucket).prefix(prefix).build()))
      for (var item : page.contents()) {
        if (!item.key().startsWith(prefix)) continue;
        String k = item.key().substring(prefix.length());
        if (ObjectStorage.validKey(k) && item.lastModified().isBefore(before))
          if (!visitor.visit(new ObjectInfo(k, item.lastModified()))) return;
      }
  }

  @Override
  public void close() {
    client.close();
  }
}
