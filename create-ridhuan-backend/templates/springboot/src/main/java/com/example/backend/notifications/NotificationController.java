package com.example.backend.notifications;

import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.http.Api;
import com.example.backend.platform.http.ApiException;
import com.example.backend.platform.security.Access;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.*;
import org.jspecify.annotations.Nullable;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
  private final NotificationService service;
  private final NotificationStreams streams;
  private final Access access;

  public NotificationController(
      NotificationService service, NotificationStreams streams, Access access) {
    this.service = service;
    this.streams = streams;
    this.access = access;
  }

  @PostMapping
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  @EndpointPolicy(EndpointId.NOTIFICATION_CREATE)
  public Api.Success<NotificationDto.Response> create(
      @Valid @RequestBody NotificationDto.Create input) {
    return Api.Success.of(service.create(input, access.actor()));
  }

  @GetMapping
  @EndpointPolicy(EndpointId.NOTIFICATION_LIST)
  public Api.Success<List<NotificationDto.Response>> list(
      @RequestParam(required = false) @Nullable UUID cursor, HttpServletResponse response) {
    var page = service.list(access.actor(), cursor);
    if (page.next() != null) response.setHeader("X-Next-Cursor", page.next().toString());
    return Api.Success.of(page.items());
  }

  @PatchMapping("/{id}/read")
  @EndpointPolicy(EndpointId.NOTIFICATION_READ)
  public Api.Success<NotificationDto.Response> read(@PathVariable UUID id) {
    return Api.Success.of(service.read(id, access.actor()));
  }

  @GetMapping(value = "/stream", produces = "text/event-stream")
  @EndpointPolicy(EndpointId.NOTIFICATION_STREAM)
  public SseEmitter stream(
      @RequestHeader(value = "Last-Event-ID", required = false) @Nullable UUID cursor,
      HttpServletRequest request) {
    if (!(SecurityContextHolder.getContext().getAuthentication()
        instanceof JwtAuthenticationToken token)) throw ApiException.unauthorized();
    return streams.open(
        access.actor(), cursor, Objects.requireNonNull(token.getToken().getExpiresAt()), request);
  }
}
