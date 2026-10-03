package com.example.backend.permissions;

import com.example.backend.platform.audit.AuditService;
import com.example.backend.platform.audit.AuditService.Snapshot;
import com.example.backend.platform.cache.UserCache;
import com.example.backend.platform.endpoint.EndpointId;
import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.security.Access;
import java.time.Clock;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PermissionService {
  private final PermissionRepository repository;
  private final AuditService audit;
  private final Access access;
  private final Clock clock;
  private final UserCache cache;

  public PermissionService(
      PermissionRepository repository,
      AuditService audit,
      Access access,
      Clock clock,
      UserCache cache) {
    this.repository = repository;
    this.cache = cache;
    this.audit = audit;
    this.access = access;
    this.clock = clock;
  }

  public List<PermissionDto.Response> list() {
    return repository.findAll().stream().map(this::dto).toList();
  }

  public PermissionDto.Response get(UUID id) {
    return dto(entity(id));
  }

  @Transactional
  public PermissionDto.Response create(PermissionDto.Create input) {
    PermissionEntity e = new PermissionEntity();
    e.id = UUID.randomUUID();
    e.name = input.name();
    e.createdAt = clock.instant();
    e.updatedAt = e.createdAt;
    repository.saveAndFlush(e);
    audit.write(EndpointId.PERMISSION_CREATE, access.actor(), "CREATE", e.id, null, snapshot(e));
    cache.invalidate();
    return dto(e);
  }

  @Transactional
  public PermissionDto.Response update(UUID id, PermissionDto.Update input) {
    PermissionEntity e = entity(id);
    Snapshot before = snapshot(e);
    if (!access.permissions(access.actor()).contains(e.name)) throw ApiException.denied();
    if (input.name() != null) e.name = input.name();
    e.updatedAt = clock.instant();
    repository.flush();
    audit.write(EndpointId.PERMISSION_UPDATE, access.actor(), "UPDATE", e.id, before, snapshot(e));
    cache.invalidate();
    return dto(e);
  }

  @Transactional
  public void delete(UUID id) {
    PermissionEntity e = entity(id);
    if (!access.permissions(access.actor()).contains(e.name)) throw ApiException.denied();
    repository.delete(e);
    repository.flush();
    audit.write(EndpointId.PERMISSION_DELETE, access.actor(), "DELETE", e.id, snapshot(e), null);
    cache.invalidate();
  }

  public PermissionEntity entity(UUID id) {
    return repository.findById(id).orElseThrow(ApiException::missing);
  }

  private Snapshot snapshot(PermissionEntity e) {
    return new Snapshot(e.id, null, e.name, null, null);
  }

  private PermissionDto.Response dto(PermissionEntity e) {
    return new PermissionDto.Response(e.id, e.name, e.createdAt, e.updatedAt);
  }
}
