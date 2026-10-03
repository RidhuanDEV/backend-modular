package com.example.backend.roles;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "roles")
public class RoleEntity {
  @Id public UUID id = UUID.randomUUID();

  @Column(nullable = false, unique = true, length = 64)
  public String name = "";

  @Column(nullable = false)
  public Instant createdAt = Instant.EPOCH;

  @Column(nullable = false)
  public Instant updatedAt = Instant.EPOCH;

  public RoleEntity() {}
}
