package com.example.backend.auth;

import com.example.backend.config.Settings;
import com.example.backend.platform.audit.AuditService;
import com.example.backend.platform.audit.AuditService.Snapshot;
import com.example.backend.platform.endpoint.EndpointId;
import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.jobs.Db;
import com.example.backend.roles.RoleRepository;
import com.example.backend.users.*;
import java.security.*;
import java.time.*;
import java.util.*;
import org.jspecify.annotations.Nullable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AuthService {
  private record Family(UUID id, UUID userId, Instant expiresAt, @Nullable Instant revokedAt) {}

  private record Token(UUID familyId, Instant expiresAt, @Nullable Instant consumedAt) {}

  private final UserRepository users;
  private final RoleRepository roles;
  private final PasswordEncoder passwords;
  private final Db db;
  private final Clock clock;
  private final AuditService audit;
  private final JwtEncoder encoder;
  private final Settings settings;
  private final TransactionTemplate transaction;
  private final SecureRandom random = new SecureRandom();
  private final String dummy;

  public AuthService(
      UserRepository users,
      RoleRepository roles,
      PasswordEncoder passwords,
      Db db,
      Clock clock,
      AuditService audit,
      JwtEncoder encoder,
      Settings settings,
      org.springframework.transaction.PlatformTransactionManager manager) {
    this.users = users;
    this.roles = roles;
    this.passwords = passwords;
    this.db = db;
    this.clock = clock;
    this.audit = audit;
    this.encoder = encoder;
    this.settings = settings;
    this.transaction = new TransactionTemplate(manager);
    dummy = passwords.encode(UUID.randomUUID().toString());
  }

  @Transactional
  public UserDto.Safe register(AuthDto.Register input) {
    Passwords.validate(input.password());
    var role =
        roles
            .findByName("USER")
            .orElseThrow(() -> new ApiException(503, "Application is not seeded"));
    UserEntity user = new UserEntity();
    user.id = UUID.randomUUID();
    user.email = Passwords.email(input.email());
    user.password = passwords.encode(input.password());
    user.roleId = role.id;
    user.createdAt = clock.instant();
    user.updatedAt = user.createdAt;
    users.saveAndFlush(user);
    audit.write(
        EndpointId.AUTH_REGISTER,
        user.id,
        "CREATE",
        user.id,
        null,
        new Snapshot(user.id, user.roleId, null, null, null));
    return safe(user);
  }

  @Transactional
  public AuthDto.Tokens login(AuthDto.Login input) {
    var found = users.findByEmail(Passwords.email(input.email()));
    boolean valid = passwords.matches(input.password(), found.map(u -> u.password).orElse(dummy));
    if (!valid || found.isEmpty() || found.get().deletedAt != null)
      throw ApiException.unauthorized();
    UserEntity user = users.lock(found.get().id).orElseThrow(ApiException::unauthorized);
    if (user.deletedAt != null) throw ApiException.unauthorized();
    Instant now = clock.instant(), expiry = now.plus(Duration.ofDays(30));
    UUID family = UUID.randomUUID();
    String raw = opaque();
    db.update(
        "INSERT INTO refresh_families(id,user_id,expires_at,created_at) VALUES(?,?,?,?)",
        family,
        user.id,
        expiry,
        now);
    insertToken(raw, family, expiry, now);
    audit.write(
        EndpointId.AUTH_LOGIN,
        user.id,
        "LOGIN",
        family,
        null,
        new Snapshot(family, null, null, null, null));
    return tokens(user.id, raw);
  }

  public AuthDto.Tokens refresh(AuthDto.Refresh input) {
    String hashed = hash(input.refreshToken());
    List<Token> initial = token(hashed);
    if (initial.isEmpty()) throw ApiException.unauthorized();
    AuthDto.Tokens result =
        transaction.execute(
            status -> {
              Family family = lockFamily(initial.getFirst().familyId());
              Token old = token(hashed).getFirst();
              Instant now = clock.instant();
              if (family.revokedAt() != null || !family.expiresAt().isAfter(now)) return null;
              UserEntity user = users.lock(family.userId()).orElseThrow(ApiException::unauthorized);
              if (user.deletedAt != null) return null;
              // Consumed token replay commits revocation before returning unauthorized.
              if (old.consumedAt() != null) {
                revoke(family, EndpointId.AUTH_REFRESH, "REPLAY");
                return null;
              }
              if (!old.expiresAt().isAfter(now)) return null;
              String raw = opaque();
              Instant expiry = now.plus(Duration.ofDays(30));
              db.update("UPDATE refresh_tokens SET consumed_at=? WHERE token_hash=?", now, hashed);
              db.update("UPDATE refresh_families SET expires_at=? WHERE id=?", expiry, family.id());
              insertToken(raw, family.id(), expiry, now);
              audit.write(
                  EndpointId.AUTH_REFRESH,
                  user.id,
                  "ROTATE",
                  family.id(),
                  null,
                  new Snapshot(family.id(), null, null, null, null));
              return tokens(user.id, raw);
            });
    if (result == null) throw ApiException.unauthorized();
    return result;
  }

  public void logout(AuthDto.Refresh input) {
    List<Token> initial = token(hash(input.refreshToken()));
    if (initial.isEmpty()) return;
    transaction.executeWithoutResult(
        status -> {
          Family family = lockFamily(initial.getFirst().familyId());
          if (family.revokedAt() == null) revoke(family, EndpointId.AUTH_LOGOUT, "LOGOUT");
        });
  }

  private void revoke(Family family, EndpointId endpoint, String behavior) {
    db.update("UPDATE refresh_families SET revoked_at=? WHERE id=?", clock.instant(), family.id());
    audit.write(
        endpoint,
        family.userId(),
        behavior,
        family.id(),
        null,
        new Snapshot(family.id(), null, null, null, null));
  }

  private Family lockFamily(UUID id) {
    return db.query(
            "SELECT * FROM refresh_families WHERE id=? FOR UPDATE",
            (r, i) ->
                new Family(
                    Db.uuid(r, "id"),
                    Db.uuid(r, "user_id"),
                    Db.instant(r, "expires_at"),
                    Db.optionalInstant(r, "revoked_at")),
            id)
        .getFirst();
  }

  private List<Token> token(String hash) {
    return db.query(
        "SELECT * FROM refresh_tokens WHERE token_hash=?",
        (r, i) ->
            new Token(
                Db.uuid(r, "family_id"),
                Db.instant(r, "expires_at"),
                Db.optionalInstant(r, "consumed_at")),
        hash);
  }

  private void insertToken(String raw, UUID family, Instant expiry, Instant now) {
    db.update(
        "INSERT INTO refresh_tokens(id,token_hash,family_id,expires_at,created_at) VALUES(?,?,?,?,?)",
        UUID.randomUUID(),
        hash(raw),
        family,
        expiry,
        now);
  }

  private AuthDto.Tokens tokens(UUID id, String refresh) {
    Instant now = clock.instant();
    var claims =
        JwtClaimsSet.builder()
            .issuer(settings.text("JWT_ISSUER", "modular-springboot"))
            .audience(List.of(settings.text("JWT_AUDIENCE", "modular-springboot")))
            .subject(id.toString())
            .issuedAt(now)
            .expiresAt(now.plusSeconds(900))
            .claim("token_use", "access")
            .build();
    return new AuthDto.Tokens(
        encoder
            .encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
            .getTokenValue(),
        refresh);
  }

  private String opaque() {
    byte[] bytes = new byte[32];
    random.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  public static String hash(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  public static UserDto.Safe safe(UserEntity u) {
    return new UserDto.Safe(u.id, u.email, u.roleId, u.createdAt, u.updatedAt);
  }
}
