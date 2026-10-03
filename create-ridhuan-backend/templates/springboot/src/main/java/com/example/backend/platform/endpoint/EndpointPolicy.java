package com.example.backend.platform.endpoint;

import java.lang.annotation.*;

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface EndpointPolicy {
  EndpointId value();
}
