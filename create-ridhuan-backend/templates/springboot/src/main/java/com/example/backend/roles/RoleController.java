package com.example.backend.roles;

import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.http.Api;
import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/roles")
public class RoleController {
  private final RoleService service;

  public RoleController(RoleService service) {
    this.service = service;
  }

  @GetMapping
  @EndpointPolicy(EndpointId.ROLE_LIST)
  public Api.Success<List<RoleDto.Response>> list() {
    return Api.Success.of(service.list());
  }

  @GetMapping("/{id}")
  @EndpointPolicy(EndpointId.ROLE_GET)
  public Api.Success<RoleDto.Response> get(@PathVariable UUID id) {
    return Api.Success.of(service.get(id));
  }

  @PostMapping
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  @EndpointPolicy(EndpointId.ROLE_CREATE)
  public Api.Success<RoleDto.Base> create(@Valid @RequestBody RoleDto.Create input) {
    return Api.Success.of(service.create(input));
  }

  @PatchMapping("/{id}")
  @EndpointPolicy(EndpointId.ROLE_UPDATE)
  public Api.Success<RoleDto.Base> update(
      @PathVariable UUID id, @Valid @RequestBody RoleDto.Update input) {
    return Api.Success.of(service.update(id, input));
  }

  @DeleteMapping("/{id}")
  @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
  @EndpointPolicy(EndpointId.ROLE_DELETE)
  public void delete(@PathVariable UUID id) {
    service.delete(id);
  }

  @PostMapping("/{id}/permissions")
  @EndpointPolicy(EndpointId.ROLE_ASSIGN_PERMISSIONS)
  public Api.Success<RoleDto.Response> assign(
      @PathVariable UUID id, @Valid @RequestBody RoleDto.Assign input) {
    return Api.Success.of(service.assign(id, input));
  }
}
