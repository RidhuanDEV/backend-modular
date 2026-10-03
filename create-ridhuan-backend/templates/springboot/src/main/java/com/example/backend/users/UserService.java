package com.example.backend.users;

import com.example.backend.auth.Passwords;
import com.example.backend.platform.audit.AuditService;
import com.example.backend.platform.audit.AuditService.Snapshot;
import com.example.backend.platform.cache.UserCache;
import com.example.backend.platform.endpoint.EndpointId;
import com.example.backend.platform.endpoint.EndpointRegistry;
import com.example.backend.platform.http.*;
import com.example.backend.platform.security.Access;
import com.example.backend.roles.RoleService;
import java.time.Clock;
import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {
  private final UserRepository repository;
  private final RoleService roles;
  private final Access access;
  private final AuditService audit;
  private final PasswordEncoder passwords;
  private final Clock clock;
  private final UserCache cache;
  private final EndpointRegistry policies;

  public UserService(
      UserRepository repository,
      RoleService roles,
      Access access,
      AuditService audit,
      PasswordEncoder passwords,
      Clock clock,
      UserCache cache,
      EndpointRegistry policies) {
    this.policies = policies;
    this.repository = repository;
    this.roles = roles;
    this.access = access;
    this.audit = audit;
    this.passwords = passwords;
    this.clock = clock;
    this.cache = cache;
  }

  public Api.Success<List<UserDto.Projection>> list(UserDto.Query q) {
    if (q.page() < 1
        || q.limit() < 1
        || q.limit() > 100
        || !Set.of("asc", "desc").contains(q.orderBy()))
      throw new ApiException(400, "Invalid pagination");
    if (!q.fields().isBlank())
      for (String field : q.fields().split(","))
        if (!Set.of("id", "email", "roleId").contains(field.trim()))
          throw new ApiException(400, "Invalid field");
    String key = cache.key(access.actor(), q);
    var cached =
        policies.get(EndpointId.USER_LIST).cache() == EndpointRegistry.Cache.read
            ? cache.get(key)
            : null;
    if (cached != null) return cached;
    String sort =
        Set.of("email", "createdAt", "updatedAt").contains(q.sortBy()) ? q.sortBy() : "createdAt";
    Sort ordering =
        Sort.by(q.orderBy().equals("asc") ? Sort.Direction.ASC : Sort.Direction.DESC, sort)
            .and(Sort.by("id"));
    Specification<UserEntity> specification =
        (root, query, builder) ->
            builder.and(
                builder.isNull(root.get("deletedAt")),
                builder.like(
                    builder.lower(root.get("email")),
                    "%"
                        + q.search()
                            .toLowerCase(Locale.ROOT)
                            .replace("\\", "\\\\")
                            .replace("%", "\\%")
                            .replace("_", "\\_")
                        + "%",
                    '\\'));
    var page = repository.findAll(specification, PageRequest.of(q.page() - 1, q.limit(), ordering));
    var roleMap =
        roles.many(page.getContent().stream().map(user -> user.roleId).distinct().toList());
    Set<String> selected =
        q.fields().isBlank()
            ? Set.of("id", "email", "roleId", "createdAt", "updatedAt", "role")
            : new HashSet<>(Arrays.stream(q.fields().split(",")).map(String::trim).toList());
    var result =
        new Api.Success<>(
            true,
            page.getContent().stream()
                .map(
                    user -> {
                      var role = Objects.requireNonNull(roleMap.get(user.roleId));
                      return new UserDto.Projection(
                          selected.contains("id") ? user.id : null,
                          selected.contains("email") ? user.email : null,
                          selected.contains("roleId") ? user.roleId : null,
                          selected.contains("createdAt") ? user.createdAt : null,
                          selected.contains("updatedAt") ? user.updatedAt : null,
                          selected.contains("role")
                              ? new UserDto.Role(
                                  role.id(),
                                  role.name(),
                                  role.permissions().stream()
                                      .map(RoleDtoLink -> RoleDtoLink.permission())
                                      .toList())
                              : null);
                    })
                .toList(),
            new Api.Pagination(
                q.page(),
                q.limit(),
                page.getTotalElements(),
                page.getTotalPages(),
                page.hasNext(),
                page.hasPrevious()));
    if (policies.get(EndpointId.USER_LIST).cache() == EndpointRegistry.Cache.read)
      cache.put(key, result);
    return result;
  }

  public UserDto.Response get(UUID id) {
    return dto(entity(id));
  }

  @Transactional
  public UserDto.Response create(UserDto.Create input) {
    Passwords.validate(input.password());
    roles.entity(input.roleId());
    access.within(access.actor(), input.roleId());
    UserEntity e = new UserEntity();
    e.id = UUID.randomUUID();
    e.email = Passwords.email(input.email());
    e.password = passwords.encode(input.password());
    e.roleId = input.roleId();
    e.createdAt = clock.instant();
    e.updatedAt = e.createdAt;
    repository.saveAndFlush(e);
    audit.write(EndpointId.USER_CREATE, access.actor(), "CREATE", e.id, null, snapshot(e));
    cache.invalidate();
    return dto(e);
  }

  @Transactional
  public UserDto.Response update(UUID id, UserDto.Update input) {
    UserEntity e = entity(id);
    access.within(access.actor(), e.roleId);
    Snapshot before = snapshot(e);
    if (input.roleId() != null) {
      roles.entity(input.roleId());
      access.within(access.actor(), input.roleId());
      e.roleId = input.roleId();
    }
    if (input.email() != null) e.email = Passwords.email(input.email());
    e.updatedAt = clock.instant();
    repository.flush();
    audit.write(EndpointId.USER_UPDATE, access.actor(), "UPDATE", id, before, snapshot(e));
    cache.invalidate();
    return dto(e);
  }

  @Transactional
  public void delete(UUID id) {
    UserEntity e = repository.lock(id).orElseThrow(ApiException::missing);
    if (e.deletedAt != null) throw ApiException.missing();
    if (id.equals(access.actor())) throw ApiException.denied();
    access.within(access.actor(), e.roleId);
    e.deletedAt = clock.instant();
    e.updatedAt = e.deletedAt;
    repository.flush();
    audit.write(EndpointId.USER_DELETE, access.actor(), "DELETE", id, snapshot(e), null);
    cache.invalidate();
  }

  public UserEntity entity(UUID id) {
    UserEntity e = repository.findById(id).orElseThrow(ApiException::missing);
    if (e.deletedAt != null) throw ApiException.missing();
    return e;
  }

  private UserDto.Response dto(UserEntity e) {
    var role = roles.dto(roles.entity(e.roleId));
    return new UserDto.Response(
        e.id,
        e.email,
        e.roleId,
        e.createdAt,
        e.updatedAt,
        new UserDto.Role(
            role.id(), role.name(), role.permissions().stream().map(v -> v.permission()).toList()));
  }

  private Snapshot snapshot(UserEntity e) {
    return new Snapshot(e.id, e.roleId, null, null, null);
  }
}
