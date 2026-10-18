package com.example.backend.uploads;

import com.example.backend.config.Settings;
import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.security.Access;
import com.example.backend.platform.storage.ObjectStorage;
import java.io.*;
import java.time.Clock;
import java.util.*;
import org.apache.tika.Tika;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class UploadService {
  private final ObjectStorage storage;
  private final UploadPersistence persistence;
  private final Settings settings;
  private final Clock clock;
  private final Access access;

  public UploadService(
      ObjectStorage storage,
      UploadPersistence persistence,
      Settings settings,
      Clock clock,
      Access access) {
    this.access = access;
    this.storage = storage;
    this.persistence = persistence;
    this.settings = settings;
    this.clock = clock;
  }

  public UploadDto upload(MultipartFile file, UUID actor) throws IOException {
    if (!settings.bool("UPLOAD_ENABLED", true)) throw new ApiException(503, "Uploads disabled");
    if (file.isEmpty()
        || file.getSize() > settings.integer("UPLOAD_MAX_BYTES", 10485760, 1, 1073741824))
      throw new ApiException(413, "Invalid upload size");
    String mime;
    try (InputStream input = new BufferedInputStream(file.getInputStream())) {
      mime = new Tika().detect(input);
    }
    if (!Arrays.asList(
            settings.text("UPLOAD_ALLOWED_MIME", "image/png,image/jpeg,application/pdf").split(","))
        .contains(mime)) throw new ApiException(400, "Unsupported file content");
    String original =
        Objects.requireNonNullElse(file.getOriginalFilename(), "file")
            .replaceAll("[\\\\/\\r\\n\\x00-\\x1f\\x7f]", "_");
    if (original.length() > 255) original = original.substring(original.length() - 255);
    UUID id = UUID.randomUUID();
    try (InputStream input = file.getInputStream()) {
      storage.put(id.toString(), input, file.getSize(), mime);
    }
    try {
      return persistence.insert(
          new UploadDto(id, original, mime, file.getSize(), clock.instant()), actor);
    } catch (RuntimeException failure) {
      try {
        storage.delete(id.toString());
      } catch (Exception cleanup) {
        org.slf4j.LoggerFactory.getLogger(getClass()).error("upload_compensation_failed id={}", id);
      }
      throw failure;
    }
  }

  public UploadDto get(UUID id, UUID actor) {
    return owned(id, actor).dto();
  }

  public void download(UUID id, UUID actor, OutputStream output) throws IOException {
    var stored = owned(id, actor);
    try (InputStream input = storage.open(stored.key())) {
      input.transferTo(output);
    }
  }

  /** Only the uploader and root users may read a file; 404 hides whether it exists. */
  private UploadPersistence.Stored owned(UUID id, UUID actor) {
    var stored = persistence.stored(id);
    if (!actor.toString().equalsIgnoreCase(String.valueOf(stored.uploader()))
        && !access.isRoot(actor)) throw ApiException.missing();
    return stored;
  }
}
