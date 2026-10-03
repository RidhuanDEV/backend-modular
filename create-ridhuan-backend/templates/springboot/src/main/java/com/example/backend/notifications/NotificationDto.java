package com.example.backend.notifications;

import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

public final class NotificationDto {
  private NotificationDto() {}

  public enum EmailStatus {
    NOT_REQUESTED,
    PENDING,
    SENT,
    FAILED
  }

  public record Create(
      @NotNull UUID recipientId,
      @NotBlank @Size(max = 160) String title,
      @NotBlank @Size(max = 4000) String body,
      @tools.jackson.databind.annotation.JsonDeserialize(using = OptionalBoolean.class)
          @io.swagger.v3.oas.annotations.media.Schema(
              requiredMode = io.swagger.v3.oas.annotations.media.Schema.RequiredMode.NOT_REQUIRED,
              defaultValue = "false")
          boolean sendEmail) {}

  public static final class OptionalBoolean
      extends tools.jackson.databind.ValueDeserializer<Boolean> {
    @Override
    public Boolean deserialize(
        tools.jackson.core.JsonParser parser,
        tools.jackson.databind.DeserializationContext context) {
      return switch (parser.currentToken()) {
        case VALUE_TRUE -> true;
        case VALUE_FALSE -> false;
        default -> context.reportInputMismatch(Boolean.class, "Expected a boolean");
      };
    }

    @Override
    public Boolean getAbsentValue(tools.jackson.databind.DeserializationContext context) {
      return false;
    }

    @Override
    public Boolean getNullValue(tools.jackson.databind.DeserializationContext context) {
      return context.reportInputMismatch(Boolean.class, "Expected a boolean");
    }
  }

  public record Response(
      UUID id,
      UUID recipientId,
      String title,
      String body,
      EmailStatus emailStatus,
      @Nullable Instant readAt,
      Instant createdAt) {}

  public record Item(Response response, long sequence) {}

  public record Page(java.util.List<Response> items, @Nullable UUID next) {}
}
