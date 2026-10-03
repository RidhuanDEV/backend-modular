package com.example.backend.platform.storage;

import com.example.backend.config.Settings;
import java.io.*;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.util.*;

public final class LocalStorage implements ObjectStorage {
  private final Path root;

  public LocalStorage(Settings settings) throws IOException {
    Path configured = Path.of(settings.text("UPLOAD_DIR", "uploads")).toAbsolutePath().normalize();
    Path current = configured;
    while (current != null) {
      if (Files.isSymbolicLink(current))
        throw new IOException("Upload root cannot contain symlinks");
      current = current.getParent();
    }
    Files.createDirectories(configured);
    root = configured.toRealPath();
  }

  private Path path(String key) throws IOException {
    if (!ObjectStorage.validKey(key)) throw new IOException("Invalid storage key");
    Path value = root.resolve(key);
    if (!root.equals(value.getParent()) || Files.isSymbolicLink(value))
      throw new IOException("Unsafe storage path");
    return value;
  }

  @Override
  public void put(String key, InputStream input, long size, String mime) throws IOException {
    Path target = path(key);
    boolean created = false;
    try (OutputStream output =
        Files.newOutputStream(target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
      created = true;
      byte[] buffer = new byte[8192];
      long copied = 0;
      int n;
      while ((n = input.read(buffer)) != -1) {
        copied += n;
        if (copied > size) throw new IOException("File size changed");
        output.write(buffer, 0, n);
      }
      if (copied != size) throw new IOException("File size changed");
    } catch (IOException e) {
      if (created) Files.deleteIfExists(target);
      throw e;
    }
  }

  @Override
  public InputStream open(String key) throws IOException {
    return Files.newInputStream(path(key), LinkOption.NOFOLLOW_LINKS);
  }

  @Override
  public void delete(String key) throws IOException {
    Files.deleteIfExists(path(key));
  }

  @Override
  public void visitOlderThan(Instant before, Visitor visitor) throws IOException {
    try (var entries = Files.newDirectoryStream(root)) {
      for (Path entry : entries) {
        String key = entry.getFileName().toString();
        if (!ObjectStorage.validKey(key) || Files.isSymbolicLink(entry)) continue;
        var attributes =
            Files.readAttributes(entry, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (attributes.isRegularFile()
            && attributes.lastModifiedTime().toInstant().isBefore(before))
          if (!visitor.visit(new ObjectInfo(key, attributes.lastModifiedTime().toInstant()))) break;
      }
    }
  }
}
