package com.example.backend.auth;

import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.http.Api;
import com.example.backend.platform.security.Access;
import com.example.backend.users.UserDto;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final AuthService service;
  private final Access access;

  public AuthController(AuthService service, Access access) {
    this.service = service;
    this.access = access;
  }

  @PostMapping("/register")
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  @EndpointPolicy(EndpointId.AUTH_REGISTER)
  public Api.Success<UserDto.Safe> register(@Valid @RequestBody AuthDto.Register input) {
    return Api.Success.of(service.register(input));
  }

  @PostMapping("/login")
  @EndpointPolicy(EndpointId.AUTH_LOGIN)
  public Api.Success<AuthDto.Tokens> login(@Valid @RequestBody AuthDto.Login input) {
    return Api.Success.of(service.login(input));
  }

  @PostMapping("/refresh")
  @EndpointPolicy(EndpointId.AUTH_REFRESH)
  public Api.Success<AuthDto.Tokens> refresh(@Valid @RequestBody AuthDto.Refresh input) {
    return Api.Success.of(service.refresh(input));
  }

  @PostMapping("/logout")
  @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
  @EndpointPolicy(EndpointId.AUTH_LOGOUT)
  public void logout(@Valid @RequestBody AuthDto.Refresh input) {
    service.logout(input);
  }

  @GetMapping("/me")
  @EndpointPolicy(EndpointId.AUTH_ME)
  public Api.Success<UserDto.Safe> me() {
    return Api.Success.of(AuthService.safe(access.active(access.actor())));
  }
}
