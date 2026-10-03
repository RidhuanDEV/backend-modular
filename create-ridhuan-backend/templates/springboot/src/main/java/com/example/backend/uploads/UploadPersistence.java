package com.example.backend.uploads;

import com.example.backend.config.Settings;
import com.example.backend.platform.audit.AuditService;
import com.example.backend.platform.audit.AuditService.Snapshot;
import com.example.backend.platform.endpoint.EndpointId;
import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.jobs.Db;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UploadPersistence {
  public record Stored(UploadDto dto, String key) {}

  private final Db db;
  private final AuditService audit;
  private final Settings settings;

  public UploadPersistence(Db db, AuditService audit, Settings settings) {
    this.db = db;
    this.audit = audit;
    this.settings = settings;
  }

  @Transactional
  public UploadDto insert(UploadDto value, UUID actor) {
    db.update(
        "INSERT INTO stored_files(id,storage,status,object_key,original_name,mime_type,size,uploader_id,created_at) VALUES(?,?,'READY',?,?,?,?,?,?)",
        value.id(),
        settings.storage().name(),
        value.id().toString(),
        value.originalName(),
        value.mimeType(),
        value.size(),
        actor,
        value.createdAt());
    audit.write(
        EndpointId.UPLOAD_CREATE,
        actor,
        "CREATE",
        value.id(),
        null,
        new Snapshot(value.id(), null, null, null, null));
    return value;
  }

  public Stored stored(UUID id) {
    var rows =
        db.query(
            "SELECT * FROM stored_files WHERE id=? AND status='READY' AND storage=?",
            (r, i) ->
                new Stored(
                    new UploadDto(
                        Db.uuid(r, "id"),
                        r.getString("original_name"),
                        r.getString("mime_type"),
                        r.getLong("size"),
                        Db.instant(r, "created_at")),
                    r.getString("object_key")),
            id,
            settings.storage().name());
    if (rows.isEmpty()) throw ApiException.missing();
    return rows.getFirst();
  }
}
