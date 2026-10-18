package com.example.backend.auth;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.*;
import org.jspecify.annotations.Nullable;

public final class AuthDto {
  private AuthDto() {}

  public record Register(@NotBlank @Email String email, @NotBlank @Size(min = 6) String password) {}

  public record Login(@NotBlank @Email String email, @NotBlank @Size(max = 72) String password) {}

  public record Refresh(@NotBlank String refreshToken) {}

  /** Optional so cookie mode can read the httpOnly cookie instead; the controller enforces it. */
  public record RefreshRequest(@Nullable @Size(min = 1) String refreshToken) {}

  public record Tokens(String token, String refreshToken) {}

  /** refreshToken is omitted when REFRESH_TOKEN_TRANSPORT=cookie (sent as an httpOnly cookie). */
  public record TokenResponse(
      String token, @JsonInclude(JsonInclude.Include.NON_NULL) @Nullable String refreshToken) {}
}
