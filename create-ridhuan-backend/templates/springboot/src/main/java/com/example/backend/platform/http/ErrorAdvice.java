package com.example.backend.platform.http;

import java.util.List;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@RestControllerAdvice
public class ErrorAdvice {
  @ExceptionHandler(ApiException.class)
  ResponseEntity<Api.Failure> domain(ApiException e) {
    return ResponseEntity.status(e.status())
        .body(
            Api.Failure.of(java.util.Objects.requireNonNullElse(e.getMessage(), "Request failed")));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<Api.Failure> validation(MethodArgumentNotValidException e) {
    List<Api.FieldError> errors =
        e.getBindingResult().getFieldErrors().stream()
            .map(v -> new Api.FieldError(v.getField(), "Invalid value"))
            .toList();
    return ResponseEntity.badRequest().body(new Api.Failure(false, "Validation failed", errors));
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<Api.Failure> conflict() {
    return ResponseEntity.status(409)
        .body(Api.Failure.of("Resource already exists or is referenced"));
  }

  @ExceptionHandler(DataAccessException.class)
  ResponseEntity<Api.Failure> unavailable() {
    return ResponseEntity.status(503).body(Api.Failure.of("Service unavailable"));
  }

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  ResponseEntity<Api.Failure> tooLarge() {
    return ResponseEntity.status(413).body(Api.Failure.of("Request body too large"));
  }

  @ExceptionHandler({
    org.springframework.web.bind.ServletRequestBindingException.class,
    org.springframework.validation.BindException.class,
    org.springframework.web.multipart.support.MissingServletRequestPartException.class
  })
  ResponseEntity<Api.Failure> missingInput() {
    return ResponseEntity.badRequest().body(Api.Failure.of("Missing or invalid request input"));
  }

  @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
  ResponseEntity<Api.Failure> missingResource() {
    return ResponseEntity.status(404).body(Api.Failure.of("Resource not found"));
  }

  @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
  ResponseEntity<Api.Failure> unsupportedMethod() {
    return ResponseEntity.status(405).body(Api.Failure.of("Method not allowed"));
  }

  @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
  ResponseEntity<Api.Failure> unsupportedMedia() {
    return ResponseEntity.status(415).body(Api.Failure.of("Unsupported media type"));
  }

  @ExceptionHandler(org.springframework.web.HttpMediaTypeNotAcceptableException.class)
  ResponseEntity<Api.Failure> unacceptableMedia() {
    return ResponseEntity.status(406).body(Api.Failure.of("Not acceptable"));
  }

  @ExceptionHandler(
      org.springframework.web.method.annotation.HandlerMethodValidationException.class)
  ResponseEntity<Api.Failure> invalidMethod(
      org.springframework.web.method.annotation.HandlerMethodValidationException failure) {
    return ResponseEntity.status(failure.getStatusCode()).body(Api.Failure.of("Validation failed"));
  }

  @ExceptionHandler(
      org.springframework.web.context.request.async.AsyncRequestNotUsableException.class)
  void disconnectedClient() {
    // The transport has already closed; writing an error body would corrupt SSE.
  }

  @ExceptionHandler({
    IllegalArgumentException.class,
    org.springframework.http.converter.HttpMessageNotReadableException.class,
    org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
    jakarta.validation.ConstraintViolationException.class
  })
  ResponseEntity<Api.Failure> malformed() {
    return ResponseEntity.badRequest().body(Api.Failure.of("Malformed request"));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Api.Failure> internal(Exception e) {
    org.slf4j.LoggerFactory.getLogger(getClass())
        .error("request_failure type={}", e.getClass().getSimpleName());
    return ResponseEntity.internalServerError().body(Api.Failure.of("Internal Server Error"));
  }
}
