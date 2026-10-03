package com.example.backend.auth;

import com.example.backend.platform.http.ApiException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class Passwords {
  private Passwords() {}

  public static String email(String value) {
    return value.trim().toLowerCase(Locale.ROOT);
  }

  public static void validate(String value) {
    if (value.length() < 6 || value.getBytes(StandardCharsets.UTF_8).length > 72)
      throw new ApiException(
          400, "Password must contain at least 6 characters and at most 72 bytes");
  }
}
