package com.example.backend.platform.security;

import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.jobs.Db;
import com.example.backend.users.UserEntity;
import com.example.backend.users.UserRepository;
import java.util.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;

@Service
public class Access {
  /** The seeded bootstrap role may grant any permission, including ones created after seeding. */
  public static final String ROOT_ROLE = "ADMIN";

  private final UserRepository users;
  private final Db jdbc;

  public Access(UserRepository users, Db jdbc) {
    this.users = users;
    this.jdbc = jdbc;
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

  private boolean root(UUID actor) {
    return !jdbc.query(
            "SELECT 1 FROM roles WHERE id=? AND name=?",
            (row, index) -> row.getInt(1),
            active(actor).roleId,
            ROOT_ROLE)
        .isEmpty();
  }

  public void within(UUID actor, UUID role) {
    if (root(actor)) return;
    if (!permissions(actor).containsAll(rolePermissions(role))) throw ApiException.denied();
  }

  public void grant(UUID actor, List<UUID> ids) {
    boolean root = root(actor);
    Set<String> own = permissions(actor);
    for (UUID id : ids) {
      List<String> names =
          jdbc.query("SELECT name FROM permissions WHERE id=?", (r, i) -> r.getString(1), id);
      if (names.isEmpty()) throw ApiException.missing();
      if (!root && !own.contains(names.getFirst())) throw ApiException.denied();
    }
  }
}
