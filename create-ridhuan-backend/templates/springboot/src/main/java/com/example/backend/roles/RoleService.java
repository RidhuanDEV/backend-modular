package com.example.backend.roles;

import com.example.backend.permissions.PermissionDto;
import com.example.backend.platform.audit.AuditService;
import com.example.backend.platform.audit.AuditService.Snapshot;
import com.example.backend.platform.cache.UserCache;
import com.example.backend.platform.endpoint.EndpointId;
import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.jobs.Db;
import com.example.backend.platform.security.Access;
import java.time.Clock;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RoleService {
  private final RoleRepository repository;
  private final AuditService audit;
  private final Access access;
  private final Clock clock;
  private final Db db;
  private final UserCache cache;

  public RoleService(
      RoleRepository repository,
      AuditService audit,
      Access access,
      Clock clock,
      Db db,
      UserCache cache) {
    this.repository = repository;
    this.cache = cache;
    this.audit = audit;
    this.access = access;
    this.clock = clock;
    this.db = db;
  }

  public List<RoleDto.Response> list() {
    return new ArrayList<>(many(repository.findAll().stream().map(r -> r.id).toList()).values());
  }

  private record Membership(UUID roleId, RoleDto.Link link) {}

  public Map<UUID, RoleDto.Response> many(Collection<UUID> ids) {
    if (ids.isEmpty()) return Map.of();
    var entities = repository.findAllById(ids);
    var memberships =
        db.query(
            "SELECT r.role_id,p.id,p.name FROM permissions p JOIN role_permissions r ON r.permission_id=p.id WHERE r.role_id IN ("
                + String.join(",", Collections.nCopies(ids.size(), "?"))
                + ") ORDER BY p.name",
            (row, i) ->
                new Membership(
                    Db.uuid(row, "role_id"),
                    new RoleDto.Link(
                        new PermissionDto.Brief(Db.uuid(row, "id"), row.getString("name")))),
            ids.toArray());
    Map<UUID, List<RoleDto.Link>> links = new HashMap<>();
    for (var membership : memberships)
      links
          .computeIfAbsent(membership.roleId(), ignored -> new ArrayList<>())
          .add(membership.link());
    Map<UUID, RoleDto.Response> result = new LinkedHashMap<>();
    for (var entity : entities)
      result.put(
          entity.id,
          new RoleDto.Response(
              entity.id,
              entity.name,
              entity.createdAt,
              entity.updatedAt,
              links.getOrDefault(entity.id, List.of())));
    return result;
  }

  public RoleDto.Response get(UUID id) {
    return dto(entity(id));
  }

  @Transactional
  public RoleDto.Base create(RoleDto.Create input) {
    RoleEntity e = new RoleEntity();
    e.id = UUID.randomUUID();
    e.name = input.name();
    e.createdAt = clock.instant();
    e.updatedAt = e.createdAt;
    repository.saveAndFlush(e);
    audit.write(EndpointId.ROLE_CREATE, access.actor(), "CREATE", e.id, null, snapshot(e));
    cache.invalidate();
    return base(e);
  }

  @Transactional
  public RoleDto.Base update(UUID id, RoleDto.Update input) {
    RoleEntity e = entity(id);
    access.within(access.actor(), e.id);
    Snapshot before = snapshot(e);
    if (input.name() != null) e.name = input.name();
    e.updatedAt = clock.instant();
    repository.flush();
    audit.write(EndpointId.ROLE_UPDATE, access.actor(), "UPDATE", e.id, before, snapshot(e));
    cache.invalidate();
    return base(e);
  }

  @Transactional
  public void delete(UUID id) {
    RoleEntity e = entity(id);
    access.within(access.actor(), id);
    repository.delete(e);
    repository.flush();
    audit.write(EndpointId.ROLE_DELETE, access.actor(), "DELETE", id, snapshot(e), null);
    cache.invalidate();
  }

  @Transactional
  public RoleDto.Response assign(UUID id, RoleDto.Assign input) {
    RoleEntity e = entity(id);
    access.within(access.actor(), id);
    access.grant(access.actor(), input.permissionIds());
    Snapshot before = permissionSnapshot(e);
    db.update("DELETE FROM role_permissions WHERE role_id=?", id);
    for (UUID permission : new HashSet<>(input.permissionIds()))
      db.update("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)", id, permission);
    audit.write(
        EndpointId.ROLE_ASSIGN_PERMISSIONS,
        access.actor(),
        "ASSIGN",
        id,
        before,
        permissionSnapshot(e));
    cache.invalidate();
    return dto(e);
  }

  public RoleEntity entity(UUID id) {
    return repository.findById(id).orElseThrow(ApiException::missing);
  }

  public RoleDto.Response dto(RoleEntity e) {
    return new RoleDto.Response(
        e.id,
        e.name,
        e.createdAt,
        e.updatedAt,
        db.query(
            "SELECT p.id,p.name FROM permissions p JOIN role_permissions r ON r.permission_id=p.id WHERE r.role_id=? ORDER BY p.name",
            (row, i) ->
                new RoleDto.Link(
                    new PermissionDto.Brief(Db.uuid(row, "id"), row.getString("name"))),
            e.id));
  }

  private Snapshot snapshot(RoleEntity e) {
    return new Snapshot(e.id, null, e.name, null, null);
  }

  private Snapshot permissionSnapshot(RoleEntity entity) {
    var ids =
        db.query(
            "SELECT permission_id FROM role_permissions WHERE role_id=? ORDER BY permission_id",
            (row, index) -> Db.uuid(row, "permission_id"),
            entity.id);
    return new Snapshot(entity.id, null, entity.name, null, null, java.util.List.copyOf(ids));
  }

  private RoleDto.Base base(RoleEntity e) {
    return new RoleDto.Base(e.id, e.name, e.createdAt, e.updatedAt);
  }
}
