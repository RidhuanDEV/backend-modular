package com.example.backend.platform.http;

import com.example.backend.platform.endpoint.EndpointId;
import org.jspecify.annotations.Nullable;

public final class RequestContext {
  public record Context(EndpointId endpoint, String requestId) {}

  private static final ThreadLocal<Context> CURRENT = new ThreadLocal<>();

  private RequestContext() {}

  public static void set(Context c) {
    CURRENT.set(c);
  }

  public static @Nullable Context current() {
    return CURRENT.get();
  }

  public static void clear() {
    CURRENT.remove();
  }
}
