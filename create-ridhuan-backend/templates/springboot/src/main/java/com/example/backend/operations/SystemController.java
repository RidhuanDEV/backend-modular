package com.example.backend.operations;

import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.http.*;
import com.example.backend.platform.jobs.Db;
import com.example.backend.platform.ratelimit.Quota;
import org.springframework.web.bind.annotation.*;

@RestController
public class SystemController {
  public record Health(String status) {}

  private final Db db;
  private final Quota quota;

  public SystemController(Db db, Quota quota) {
    this.db = db;
    this.quota = quota;
  }

  @GetMapping("/health")
  @EndpointPolicy(EndpointId.HEALTH_GET)
  public Api.Success<Health> health() {
    return Api.Success.of(new Health("ok"));
  }

  @GetMapping("/live")
  @EndpointPolicy(EndpointId.LIVE_GET)
  public Api.Success<Health> live() {
    return Api.Success.of(new Health("ok"));
  }

  @GetMapping("/ready")
  @EndpointPolicy(EndpointId.READY_GET)
  public Api.Success<Health> ready() {
    if (db.count("SELECT 1") != 1 || !quota.ready())
      throw new ApiException(503, "Service unavailable");
    return health();
  }
}
