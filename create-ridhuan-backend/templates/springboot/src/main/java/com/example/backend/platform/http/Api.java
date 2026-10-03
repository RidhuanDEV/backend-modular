package com.example.backend.platform.http;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import org.jspecify.annotations.Nullable;

public final class Api {
  private Api() {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Success<T>(boolean success, T data, @Nullable Pagination meta) {
    public static <T> Success<T> of(T data) {
      return new Success<>(true, data, null);
    }
  }

  public record Pagination(
      int page,
      int limit,
      long totalItems,
      long totalPages,
      boolean hasNextPage,
      boolean hasPrevPage) {}

  public record FieldError(String field, String message) {}

  public record Failure(boolean success, String message, List<FieldError> errors) {
    public static Failure of(String message) {
      return new Failure(false, message, List.of());
    }
  }
}
