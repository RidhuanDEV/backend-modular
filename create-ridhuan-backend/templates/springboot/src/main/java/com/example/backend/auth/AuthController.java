package com.example.backend.auth;

import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.http.Api;
import com.example.backend.platform.security.Access;
import com.example.backend.users.UserDto;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final AuthService service;
  private final Access access;
  private final RefreshCookies cookies;

  public AuthController(AuthService service, Access access, RefreshCookies cookies) {
    this.service = service;
    this.access = access;
    this.cookies = cookies;
  }

  @PostMapping("/register")
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  @EndpointPolicy(EndpointId.AUTH_REGISTER)
  public Api.Success<UserDto.Safe> register(@Valid @RequestBody AuthDto.Register input) {
    return Api.Success.of(service.register(input));
  }

  @PostMapping("/login")
  @EndpointPolicy(EndpointId.AUTH_LOGIN)
  public Api.Success<AuthDto.TokenResponse> login(
      @Valid @RequestBody AuthDto.Login input, HttpServletResponse response) {
    return Api.Success.of(cookies.issue(response, service.login(input)));
  }

  @PostMapping("/refresh")
  @EndpointPolicy(EndpointId.AUTH_REFRESH)
  public Api.Success<AuthDto.TokenResponse> refresh(
      @Valid @RequestBody AuthDto.RefreshRequest input,
      HttpServletRequest request,
      HttpServletResponse response) {
    var token = new AuthDto.Refresh(cookies.token(request, input.refreshToken()));
    return Api.Success.of(cookies.issue(response, service.refresh(token)));
  }

  @PostMapping("/logout")
  @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
  @EndpointPolicy(EndpointId.AUTH_LOGOUT)
  public void logout(
      @Valid @RequestBody AuthDto.RefreshRequest input,
      HttpServletRequest request,
      HttpServletResponse response) {
    service.logout(new AuthDto.Refresh(cookies.token(request, input.refreshToken())));
    cookies.clear(response);
  }

  @GetMapping("/me")
  @EndpointPolicy(EndpointId.AUTH_ME)
  public Api.Success<UserDto.Safe> me() {
    return Api.Success.of(AuthService.safe(access.active(access.actor())));
  }
}
