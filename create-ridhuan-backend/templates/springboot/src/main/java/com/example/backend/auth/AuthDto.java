package com.example.backend.auth;

import jakarta.validation.constraints.*;

public final class AuthDto {
  private AuthDto() {}

  public record Register(@NotBlank @Email String email, @NotBlank @Size(min = 6) String password) {}

  public record Login(@NotBlank @Email String email, @NotBlank String password) {}

  public record Refresh(@NotBlank String refreshToken) {}

  public record Tokens(String token, String refreshToken) {}
}
