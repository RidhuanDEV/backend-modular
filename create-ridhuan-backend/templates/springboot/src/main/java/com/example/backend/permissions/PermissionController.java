package com.example.backend.permissions;

import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.http.Api;
import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/permissions")
public class PermissionController {
  private final PermissionService service;

  public PermissionController(PermissionService service) {
    this.service = service;
  }

  @GetMapping
  @EndpointPolicy(EndpointId.PERMISSION_LIST)
  public Api.Success<List<PermissionDto.Response>> list() {
    return Api.Success.of(service.list());
  }

  @GetMapping("/{id}")
  @EndpointPolicy(EndpointId.PERMISSION_GET)
  public Api.Success<PermissionDto.Response> get(@PathVariable UUID id) {
    return Api.Success.of(service.get(id));
  }

  @PostMapping
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  @EndpointPolicy(EndpointId.PERMISSION_CREATE)
  public Api.Success<PermissionDto.Response> create(
      @Valid @RequestBody PermissionDto.Create input) {
    return Api.Success.of(service.create(input));
  }

  @PatchMapping("/{id}")
  @EndpointPolicy(EndpointId.PERMISSION_UPDATE)
  public Api.Success<PermissionDto.Response> update(
      @PathVariable UUID id, @Valid @RequestBody PermissionDto.Update input) {
    return Api.Success.of(service.update(id, input));
  }

  @DeleteMapping("/{id}")
  @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
  @EndpointPolicy(EndpointId.PERMISSION_DELETE)
  public void delete(@PathVariable UUID id) {
    service.delete(id);
  }
}
