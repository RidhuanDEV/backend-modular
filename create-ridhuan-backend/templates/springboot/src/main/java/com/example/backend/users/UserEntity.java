package com.example.backend.users;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

@Entity
@Table(name = "app_users")
public class UserEntity {
  @Id public UUID id = UUID.randomUUID();

  @Column(nullable = false, unique = true, length = 255)
  public String email = "";

  @Column(nullable = false, length = 255)
  public String password = "";

  @Column(nullable = false)
  public UUID roleId = new UUID(0, 0);

  @Column() public @Nullable Instant deletedAt;

  @Column(nullable = false)
  public Instant createdAt = Instant.EPOCH;

  @Column(nullable = false)
  public Instant updatedAt = Instant.EPOCH;

  public UserEntity() {}
}
