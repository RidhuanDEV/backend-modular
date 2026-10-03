package com.example.backend.platform.storage;

import java.io.*;
import java.time.Instant;

public interface ObjectStorage {
  static boolean validKey(String value) {
    return value.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
  }

  record ObjectInfo(String key, Instant modified) {}

  void put(String key, InputStream input, long size, String mime) throws IOException;

  InputStream open(String key) throws IOException;

  void delete(String key) throws IOException;

  @FunctionalInterface
  interface Visitor {
    boolean visit(ObjectInfo object) throws IOException;
  }

  void visitOlderThan(Instant before, Visitor visitor) throws IOException;
}
