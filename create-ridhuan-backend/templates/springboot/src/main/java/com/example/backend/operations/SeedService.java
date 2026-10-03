package com.example.backend.operations;

import com.example.backend.auth.Passwords;
import com.example.backend.config.Settings;
import com.example.backend.permissions.*;
import com.example.backend.platform.jobs.Db;
import com.example.backend.roles.*;
import com.example.backend.users.*;
import java.time.Clock;
import java.util.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SeedService {
  private final RoleRepository roles;
  private final PermissionRepository permissions;
  private final UserRepository users;
  private final Db db;
  private final Settings settings;
  private final Clock clock;
  private final PasswordEncoder encoder;

  public SeedService(
      RoleRepository roles,
      PermissionRepository permissions,
      UserRepository users,
      Db db,
      Settings settings,
      Clock clock,
      PasswordEncoder encoder) {
    this.roles = roles;
    this.permissions = permissions;
    this.users = users;
    this.db = db;
    this.settings = settings;
    this.clock = clock;
    this.encoder = encoder;
  }

  @Transactional
  public void seed() {
    var admin = role("ADMIN");
    role("USER");
    for (String name :
        List.of(
            "manage_users",
            "manage_roles",
            "manage_permissions",
            "manage_uploads",
            "manage_notifications")) {
      var permission =
          permissions
              .findByName(name)
              .orElseGet(
                  () -> {
                    var e = new PermissionEntity();
                    e.id = UUID.randomUUID();
                    e.name = name;
                    e.createdAt = clock.instant();
                    e.updatedAt = e.createdAt;
                    return permissions.saveAndFlush(e);
                  });
      if (db.count(
              "SELECT COUNT(*) FROM role_permissions WHERE role_id=? AND permission_id=?",
              admin.id,
              permission.id)
          == 0)
        db.update(
            "INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",
            admin.id,
            permission.id);
    }
    String email = Passwords.email(settings.text("ADMIN_EMAIL", "admin@example.com"));
    if (users.findByEmail(email).isEmpty()) {
      String password = settings.text("ADMIN_PASSWORD", "");
      Passwords.validate(password);
      var e = new UserEntity();
      e.id = UUID.randomUUID();
      e.email = email;
      e.password = encoder.encode(password);
      e.roleId = admin.id;
      e.createdAt = clock.instant();
      e.updatedAt = e.createdAt;
      users.saveAndFlush(e);
    }
  }

  private RoleEntity role(String name) {
    return roles
        .findByName(name)
        .orElseGet(
            () -> {
              var e = new RoleEntity();
              e.id = UUID.randomUUID();
              e.name = name;
              e.createdAt = clock.instant();
              e.updatedAt = e.createdAt;
              return roles.saveAndFlush(e);
            });
  }
}
