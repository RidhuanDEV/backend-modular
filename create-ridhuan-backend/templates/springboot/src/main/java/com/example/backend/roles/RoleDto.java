package com.example.backend.roles;

import com.example.backend.permissions.PermissionDto;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

public final class RoleDto {
  private RoleDto() {}

  public record Create(@NotBlank @Size(max = 64) String name) {}

  public record Update(@Nullable @Size(min = 1, max = 64) String name) {}

  public record Assign(@NotEmpty List<@NotNull UUID> permissionIds) {}

  public record Link(PermissionDto.Brief permission) {}

  public record Response(
      UUID id, String name, Instant createdAt, Instant updatedAt, List<Link> permissions) {}

  public record Base(UUID id, String name, Instant createdAt, Instant updatedAt) {}
}
