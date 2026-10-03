package com.example.backend.users;

import com.example.backend.permissions.PermissionDto;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

public final class UserDto {
  private UserDto() {}

  public record Create(
      @NotBlank @Email String email,
      @NotBlank @Size(min = 6) String password,
      @NotNull UUID roleId) {}

  public record Update(@Nullable @Email String email, @Nullable UUID roleId) {}

  public record Safe(UUID id, String email, UUID roleId, Instant createdAt, Instant updatedAt) {}

  public record Role(UUID id, String name, List<PermissionDto.Brief> permissions) {}

  public record Response(
      UUID id, String email, UUID roleId, Instant createdAt, Instant updatedAt, Role role) {}

  @com.fasterxml.jackson.annotation.JsonInclude(
      com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
  public record Projection(
      @Nullable UUID id,
      @Nullable String email,
      @Nullable UUID roleId,
      @Nullable Instant createdAt,
      @Nullable Instant updatedAt,
      @Nullable Role role) {}

  public record Query(
      @Min(1) int page,
      @Min(1) @Max(100) int limit,
      String sortBy,
      String orderBy,
      String search,
      String fields) {}
}
