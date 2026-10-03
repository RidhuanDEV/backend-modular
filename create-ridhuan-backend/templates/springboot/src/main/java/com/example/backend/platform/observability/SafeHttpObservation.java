package com.example.backend.platform.observability;

import io.micrometer.common.*;
import org.springframework.http.server.observation.*;
import org.springframework.stereotype.Component;

@Component
public final class SafeHttpObservation extends DefaultServerRequestObservationConvention {
  @Override
  public KeyValues getHighCardinalityKeyValues(ServerRequestObservationContext context) {
    return KeyValues.empty();
  }
}
