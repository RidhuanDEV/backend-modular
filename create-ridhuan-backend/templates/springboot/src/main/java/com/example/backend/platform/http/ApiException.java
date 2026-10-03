package com.example.backend.platform.http;

public final class ApiException extends RuntimeException {
  private final int status;

  public ApiException(int status, String message) {
    super(message);
    this.status = status;
  }

  public int status() {
    return status;
  }

  public static ApiException missing() {
    return new ApiException(404, "Resource not found");
  }

  public static ApiException denied() {
    return new ApiException(403, "Forbidden");
  }

  public static ApiException unauthorized() {
    return new ApiException(401, "Unauthorized");
  }
}
