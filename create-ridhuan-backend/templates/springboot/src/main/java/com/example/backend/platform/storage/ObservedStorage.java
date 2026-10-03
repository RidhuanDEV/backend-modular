package com.example.backend.platform.storage;

import com.example.backend.platform.observability.Telemetry;
import com.example.backend.platform.observability.Telemetry.Operation;
import java.io.*;
import java.time.Instant;

final class ObservedStorage implements ObjectStorage {
  private final ObjectStorage delegate;
  private final Telemetry telemetry;

  ObservedStorage(ObjectStorage delegate, Telemetry telemetry) {
    this.delegate = delegate;
    this.telemetry = telemetry;
  }

  public void put(String key, InputStream input, long size, String mime) throws IOException {
    telemetry.observeIo(
        Operation.storage_upload,
        () -> {
          delegate.put(key, input, size, mime);
          return true;
        });
  }

  public InputStream open(String key) throws IOException {
    return telemetry.observeIo(Operation.storage_download, () -> delegate.open(key));
  }

  public void delete(String key) throws IOException {
    telemetry.observeIo(
        Operation.storage_cleanup,
        () -> {
          delegate.delete(key);
          return true;
        });
  }

  public void visitOlderThan(Instant before, Visitor visitor) throws IOException {
    telemetry.observeIo(
        Operation.storage_cleanup,
        () -> {
          delegate.visitOlderThan(before, visitor);
          return true;
        });
  }
}
