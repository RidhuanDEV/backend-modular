package com.example.backend.permissions;

import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

public final class PermissionDto {
  private PermissionDto() {}

  public record Create(@NotBlank @Size(max = 128) String name) {}

  public record Update(@Nullable @Size(min = 1, max = 128) String name) {}

  public record Brief(UUID id, String name) {}

  public record Response(UUID id, String name, Instant createdAt, Instant updatedAt) {}
}
