package com.example.backend.platform.endpoint;

import com.example.backend.platform.http.*;
import com.example.backend.platform.ratelimit.Quota;
import com.example.backend.platform.security.Access;
import jakarta.servlet.http.*;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.AsyncHandlerInterceptor;

@Component
public class PolicyInterceptor implements AsyncHandlerInterceptor {
  private final EndpointRegistry registry;
  private final Access access;
  private final Quota quota;
  private final io.micrometer.core.instrument.MeterRegistry metrics;

  public PolicyInterceptor(
      EndpointRegistry registry,
      Access access,
      Quota quota,
      io.micrometer.core.instrument.MeterRegistry metrics) {
    this.metrics = metrics;
    this.registry = registry;
    this.access = access;
    this.quota = quota;
  }

  @Override
  public boolean preHandle(
      HttpServletRequest request, HttpServletResponse response, Object handler) {
    // Completion dispatches must not rerun authorization/quota after stream headers.
    if (request.getDispatcherType() == jakarta.servlet.DispatcherType.ASYNC
        || request.getDispatcherType() == jakarta.servlet.DispatcherType.ERROR) return true;
    if (request.getMethod().equals("OPTIONS")) return true;
    EndpointPolicy annotation =
        handler instanceof HandlerMethod method
            ? method.getMethodAnnotation(EndpointPolicy.class)
            : null;
    EndpointId id =
        annotation == null ? infrastructure(request.getRequestURI()) : annotation.value();
    if (id == null) {
      if (request.getRequestURI().startsWith("/api/"))
        throw new ApiException(404, "Resource not found");
      return true;
    }
    String supplied = request.getHeader("X-Request-ID");
    String requestId =
        supplied != null && supplied.matches("[A-Za-z0-9._-]{1,64}")
            ? supplied
            : UUID.randomUUID().toString();
    request.setAttribute("endpointMetric", id.wire());
    request.setAttribute("metricStart", System.nanoTime());
    RequestContext.set(new RequestContext.Context(id, requestId));
    MDC.put("requestId", requestId);
    MDC.put("endpointId", id.wire());
    response.setHeader("X-Request-ID", requestId);
    var policy = registry.get(id);
    try {
      quota.consume(policy.rateLimit(), request.getRemoteAddr());
      if (policy.internal()) access.require(policy.permission());
      return true;
    } catch (RuntimeException failure) {
      int status =
          failure instanceof ApiException api
              ? api.status()
              : failure instanceof org.springframework.dao.DataAccessException ? 503 : 500;
      metrics
          .counter(
              "backend.http.requests", "operation", id.wire(), "status", Integer.toString(status))
          .increment();
      clear();
      throw failure;
    }
  }

  private @org.jspecify.annotations.Nullable EndpointId infrastructure(String path) {
    return path.equals("/docs/openapi.json") || path.equals("/docs/openapi.json/swagger-config")
        ? EndpointId.DOCS_SPEC
        : path.equals("/docs") || path.startsWith("/swagger-ui") ? EndpointId.DOCS_UI : null;
  }

  @Override
  public void afterCompletion(
      HttpServletRequest r,
      HttpServletResponse s,
      Object h,
      @org.jspecify.annotations.Nullable Exception e) {
    Object id = r.getAttribute("endpointMetric"), start = r.getAttribute("metricStart");
    if (id instanceof String operation && start instanceof Long begun) {
      metrics
          .counter(
              "backend.http.requests",
              "operation",
              operation,
              "status",
              Integer.toString(s.getStatus()))
          .increment();
      metrics
          .timer("backend.http.duration", "operation", operation)
          .record(System.nanoTime() - begun, java.util.concurrent.TimeUnit.NANOSECONDS);
    }
    clear();
  }

  @Override
  public void afterConcurrentHandlingStarted(
      HttpServletRequest r, HttpServletResponse s, Object h) {
    clear();
  }

  private static void clear() {
    RequestContext.clear();
    MDC.remove("requestId");
    MDC.remove("endpointId");
  }
}
