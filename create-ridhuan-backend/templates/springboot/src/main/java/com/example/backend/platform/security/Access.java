package com.example.backend.platform.security;

import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.jobs.Db;
import com.example.backend.users.UserEntity;
import com.example.backend.users.UserRepository;
import java.time.Clock;
import java.util.*;
import org.jspecify.annotations.Nullable;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;

@Service
public class Access {
  /** The seeded administrator role; access is decided by RBAC, only uploads trust it by name. */
  public static final String ROOT_ROLE = "ADMIN";

  public static final String DEFAULT_ROLE = "USER";

  /**
   * Code depends on these by name (registration, upload ownership, route permissions), so they
   * cannot be renamed, deleted or recreated; renaming a permission would mint access.
   */
  public static final Set<String> SYSTEM_ROLES = Set.of(ROOT_ROLE, DEFAULT_ROLE);

  public static final Set<String> SYSTEM_PERMISSIONS =
      Set.of(
          "manage_users",
          "manage_roles",
          "manage_permissions",
          "manage_uploads",
          "manage_notifications");

  private final UserRepository users;
  private final Db jdbc;
  private final Clock clock;

  public Access(UserRepository users, Db jdbc, Clock clock) {
    this.users = users;
    this.jdbc = jdbc;
    this.clock = clock;
  }

  /** Reserved names are compared case-insensitively so look-alike system names cannot be minted. */
  public static void notSystemName(Set<String> names, String kind, @Nullable String name) {
    if (name == null) return;
    for (String reserved : names)
      if (reserved.equalsIgnoreCase(name))
        throw new ApiException(
            403, "System " + kind + " '" + name + "' cannot be created, renamed or deleted");
  }

  public UUID actor() {
    if (!(SecurityContextHolder.getContext().getAuthentication()
        instanceof JwtAuthenticationToken token)) throw ApiException.unauthorized();
    return UUID.fromString(token.getToken().getSubject());
  }

  public UserEntity active(UUID id) {
    UserEntity user = users.findById(id).orElseThrow(ApiException::unauthorized);
    if (user.deletedAt != null) throw ApiException.unauthorized();
    return user;
  }

  public Set<String> permissions(UUID actor) {
    return rolePermissions(active(actor).roleId);
  }

  public Set<String> rolePermissions(UUID role) {
    return new HashSet<>(
        jdbc.query(
            "SELECT p.name FROM permissions p JOIN role_permissions r ON r.permission_id=p.id WHERE r.role_id=?",
            (row, index) -> row.getString(1),
            role));
  }

  public void require(String permission) {
    if (!permission.isEmpty() && !permissions(actor()).contains(permission))
      throw ApiException.denied();
    active(actor());
  }

  public boolean isRoot(UUID actor) {
    return jdbc.query(
            "SELECT name FROM roles WHERE id=?", (r, i) -> r.getString(1), active(actor).roleId)
        .contains(ROOT_ROLE);
  }

  public void within(UUID actor, UUID role) {
    if (!permissions(actor).containsAll(rolePermissions(role))) throw ApiException.denied();
  }

  public void grant(UUID actor, List<UUID> ids) {
    Set<String> own = permissions(actor);
    for (UUID id : ids) {
      List<String> names =
          jdbc.query("SELECT name FROM permissions WHERE id=?", (r, i) -> r.getString(1), id);
      if (names.isEmpty()) throw ApiException.missing();
      if (!own.contains(names.getFirst())) throw ApiException.denied();
    }
  }

  /**
   * Lockout guard: every system permission must stay held by at least one active user, or nobody
   * could grant it again. Locks the system permission rows in a fixed order so concurrent RBAC
   * mutations serialize, and returns a check to run after the mutation is flushed in the same
   * transaction. Only permissions that become unheld fail.
   */
  public Runnable guardSystemPermissionHolders() {
    for (String name : new TreeSet<>(SYSTEM_PERMISSIONS))
      jdbc.query("SELECT id FROM permissions WHERE name=? FOR UPDATE", (r, i) -> 1, name);
    Set<String> before = unheldSystemPermissions();
    return () -> {
      TreeSet<String> lost = new TreeSet<>(unheldSystemPermissions());
      lost.removeAll(before);
      if (!lost.isEmpty())
        throw new ApiException(
            403, "Change would leave no active user holding '" + lost.getFirst() + "'");
    };
  }

  private Set<String> unheldSystemPermissions() {
    Set<String> unheld = new HashSet<>();
    for (String name : SYSTEM_PERMISSIONS)
      if (jdbc.count(
              "SELECT COUNT(*) FROM app_users u JOIN role_permissions rp ON rp.role_id=u.role_id"
                  + " JOIN permissions p ON p.id=rp.permission_id"
                  + " WHERE p.name=? AND u.deleted_at IS NULL",
              name)
          == 0) unheld.add(name);
    return unheld;
  }

  /**
   * RBAC only: a new permission goes to every role that manages permissions, so its creator and
   * other permission managers can hand it out without a role-name exemption.
   */
  public void grantToPermissionManagers(UUID permission) {
    for (UUID role :
        jdbc.query(
            "SELECT rp.role_id FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id"
                + " WHERE p.name='manage_permissions'",
            (r, i) -> Db.uuid(r, "role_id")))
      jdbc.update(
          "INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)", role, permission);
  }

  /** Access changed: every refresh session must re-authenticate under the new rules. */
  public void revokeSessions(UUID user) {
    jdbc.update(
        "UPDATE refresh_families SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
        clock.instant(),
        user);
  }
}
