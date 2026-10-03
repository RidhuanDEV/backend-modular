package com.example.backend.permissions;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "permissions")
public class PermissionEntity {
  @Id public UUID id = UUID.randomUUID();

  @Column(nullable = false, unique = true, length = 128)
  public String name = "";

  @Column(nullable = false)
  public Instant createdAt = Instant.EPOCH;

  @Column(nullable = false)
  public Instant updatedAt = Instant.EPOCH;

  public PermissionEntity() {}
}
