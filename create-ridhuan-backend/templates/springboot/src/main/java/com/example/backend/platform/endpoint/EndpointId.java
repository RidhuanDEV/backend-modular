package com.example.backend.platform.endpoint;

public enum EndpointId {
  HEALTH_GET("health.get"),
  LIVE_GET("live.get"),
  READY_GET("ready.get"),
  DOCS_SPEC("docs.spec"),
  DOCS_MODULE_SPEC("docs.moduleSpec"),
  DOCS_UI("docs.ui"),
  AUTH_REGISTER("auth.register"),
  AUTH_LOGIN("auth.login"),
  AUTH_REFRESH("auth.refresh"),
  AUTH_LOGOUT("auth.logout"),
  AUTH_ME("auth.me"),
  USER_LIST("user.list"),
  USER_GET("user.get"),
  USER_CREATE("user.create"),
  USER_UPDATE("user.update"),
  USER_DELETE("user.delete"),
  ROLE_LIST("role.list"),
  ROLE_GET("role.get"),
  ROLE_CREATE("role.create"),
  ROLE_UPDATE("role.update"),
  ROLE_DELETE("role.delete"),
  ROLE_ASSIGN_PERMISSIONS("role.assignPermissions"),
  PERMISSION_LIST("permission.list"),
  PERMISSION_GET("permission.get"),
  PERMISSION_CREATE("permission.create"),
  PERMISSION_UPDATE("permission.update"),
  PERMISSION_DELETE("permission.delete"),
  UPLOAD_CREATE("upload.create"),
  UPLOAD_GET("upload.get"),
  NOTIFICATION_CREATE("notification.create"),
  NOTIFICATION_LIST("notification.list"),
  NOTIFICATION_READ("notification.read"),
  NOTIFICATION_STREAM("notification.stream");
  private final String wire;

  EndpointId(String wire) {
    this.wire = wire;
  }

  public String wire() {
    return wire;
  }

  public static EndpointId wire(String value) {
    for (EndpointId id : values()) if (id.wire.equals(value)) return id;
    throw new IllegalArgumentException("Unknown endpoint ID");
  }
}
