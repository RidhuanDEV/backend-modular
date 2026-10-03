package com.example.backend.users;

import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.http.Api;
import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
public class UserController {
  private final UserService service;

  public UserController(UserService service) {
    this.service = service;
  }

  @GetMapping
  @EndpointPolicy(EndpointId.USER_LIST)
  public Api.Success<List<UserDto.Projection>> list(
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int limit,
      @RequestParam(defaultValue = "createdAt") String sortBy,
      @RequestParam(defaultValue = "desc") String orderBy,
      @RequestParam(defaultValue = "") String search,
      @RequestParam(defaultValue = "") String fields) {
    return service.list(new UserDto.Query(page, limit, sortBy, orderBy, search, fields));
  }

  @GetMapping("/{id}")
  @EndpointPolicy(EndpointId.USER_GET)
  public Api.Success<UserDto.Response> get(@PathVariable UUID id) {
    return Api.Success.of(service.get(id));
  }

  @PostMapping
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  @EndpointPolicy(EndpointId.USER_CREATE)
  public Api.Success<UserDto.Response> create(@Valid @RequestBody UserDto.Create input) {
    return Api.Success.of(service.create(input));
  }

  @PatchMapping("/{id}")
  @EndpointPolicy(EndpointId.USER_UPDATE)
  public Api.Success<UserDto.Response> update(
      @PathVariable UUID id, @Valid @RequestBody UserDto.Update input) {
    return Api.Success.of(service.update(id, input));
  }

  @DeleteMapping("/{id}")
  @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
  @EndpointPolicy(EndpointId.USER_DELETE)
  public void delete(@PathVariable UUID id) {
    service.delete(id);
  }
}
