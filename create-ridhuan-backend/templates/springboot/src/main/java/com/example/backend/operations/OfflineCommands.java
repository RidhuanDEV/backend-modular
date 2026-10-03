package com.example.backend.operations;

import com.example.backend.BackendApplication;
import java.nio.file.*;
import java.security.SecureRandom;
import java.util.*;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.*;

public final class OfflineCommands {
  private OfflineCommands() {}

  public static String option(String[] args, String name, String fallback) {
    for (String arg : args)
      if (arg.startsWith("--" + name + "=")) return arg.substring(name.length() + 3);
    return fallback;
  }

  public static String mode(String[] args) {
    String env =
        Objects.requireNonNullElse(
            System.getenv("APP_MODE"),
            com.example.backend.config.LocalEnvironment.load(Path.of("."))
                .getOrDefault("APP_MODE", "http"));
    return option(args, "app.mode", env);
  }

  public static boolean run(String[] args) throws Exception {
    String mode = mode(args);
    if (mode.equals("initialize")) {
      initialize(args);
      return true;
    }
    if (mode.equals("generate-module")) {
      generate(args);
      return true;
    }
    return false;
  }

  private static void initialize(String[] args) throws Exception {
    String provider = option(args, "db.provider", "postgresql");
    if (!Set.of("postgresql", "mysql").contains(provider))
      throw new IllegalArgumentException("Invalid DB_PROVIDER");
    int port = Integer.parseInt(option(args, "port", "8080"));
    if (port < 1 || port > 65535) throw new IllegalArgumentException("Invalid PORT");
    String source =
        Files.readString(Path.of(provider.equals("mysql") ? ".env.mysql.example" : ".env.example"));
    String dbPassword = secret(24);
    Map<String, String> values =
        Map.of(
            "JWT_SECRET",
            secret(48),
            "ADMIN_PASSWORD",
            secret(24),
            "DB_PASSWORD",
            dbPassword,
            "POSTGRES_PASSWORD",
            dbPassword,
            "MYSQL_PASSWORD",
            dbPassword,
            "MYSQL_ROOT_PASSWORD",
            secret(24),
            "PORT",
            Integer.toString(port),
            "APP_PORT",
            Integer.toString(port));
    for (var entry : values.entrySet())
      source =
          source.replaceAll(
              "(?m)^" + entry.getKey() + "=.*$", entry.getKey() + "=" + entry.getValue());
    Files.writeString(Path.of(".env"), source, StandardOpenOption.CREATE_NEW);
    System.out.println(
        "Created .env; inspect it locally before migration. No database changes performed.");
  }

  private static String secret(int bytes) {
    byte[] value = new byte[bytes];
    new SecureRandom().nextBytes(value);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
  }

  private static void generate(String[] args) throws Exception {
    String name = option(args, "module.name", "");
    if (!name.matches("[A-Z][A-Za-z0-9]{0,48}")
        || Set.of(
                "Class",
                "Record",
                "Enum",
                "Interface",
                "User",
                "Role",
                "Permission",
                "Notification",
                "Auth",
                "Upload",
                "System")
            .contains(name)) throw new IllegalArgumentException("Invalid or reserved module.name");
    String feature = name.toLowerCase(Locale.ROOT);
    String route = feature + "s";
    String enumeration = name.replaceAll("([a-z])([A-Z])", "$1_$2").toUpperCase(Locale.ROOT);
    String base = BackendApplication.class.getPackageName();
    Path root = Path.of("").toAbsolutePath().normalize();
    String packagePath = base.replace('.', '/');
    Path source = root.resolve("src/main/java/" + packagePath + "/" + feature);
    Path enumFile =
        root.resolve("src/main/java/" + packagePath + "/platform/endpoint/EndpointId.java");
    Path registryFile = root.resolve("src/main/resources/contracts/endpoints.json");
    var mapper = JsonMapper.builder().build();
    ObjectNode manifest = (ObjectNode) mapper.readTree(Files.readString(registryFile));
    ArrayNode operations = (ArrayNode) manifest.get("operations");
    for (var operation : operations)
      if (operation.get("module").asText().equals(feature))
        throw new IllegalArgumentException("Module already registered");
    Map<Path, String> output = new LinkedHashMap<>();
    output.put(
        source.resolve("package-info.java"),
        "@org.jspecify.annotations.NullMarked\npackage " + base + "." + feature + ";\n");
    for (String kind : List.of("Entity", "Repository", "Dto", "Service", "Controller")) {
      String resource = "/templates/module/" + kind + ".java.txt";
      String template;
      try (var stream =
          Objects.requireNonNull(OfflineCommands.class.getResourceAsStream(resource))) {
        template = new String(stream.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
      }
      output.put(
          source.resolve(name + kind + ".java"),
          template
              .replace("__PACKAGE__", base)
              .replace("__FEATURE__", feature)
              .replace("__NAME__", name)
              .replace("__ROUTE__", route)
              .replace("__ENUM__", enumeration));
    }
    String enumText = Files.readString(enumFile);
    int enumEnd = enumText.indexOf("private final String wire;");
    int separator = enumText.lastIndexOf(';', enumEnd);
    List<String> constants = new ArrayList<>();
    for (String behavior : List.of("list", "get", "create", "update", "delete")) {
      String id = feature + "." + behavior,
          method =
              switch (behavior) {
                case "create" -> "POST";
                case "update" -> "PATCH";
                case "delete" -> "DELETE";
                default -> "GET";
              };
      constants.add(enumeration + "_" + behavior.toUpperCase(Locale.ROOT) + "(\"" + id + "\")");
      var operation = operations.addObject();
      operation
          .put("id", id)
          .put("method", method)
          .put(
              "path",
              "/api/"
                  + route
                  + (Set.of("get", "update", "delete").contains(behavior) ? "/{id}" : ""))
          .put("module", feature)
          .put("internal", true)
          .put("permission", "manage_" + route)
          .put("audit", method.equals("GET") ? "none" : "required")
          .put("auditCapability", method.equals("GET") ? "read" : "transaction")
          .put("cache", "off")
          .put("rateLimit", "internal")
          .put("status", behavior.equals("create") ? 201 : behavior.equals("delete") ? 204 : 200)
          .put("mediaType", "application/json")
          .put("requestDto", method.equals("GET") ? "none" : name + "Dto")
          .put("responseDto", behavior.equals("delete") ? "void" : name + "Dto.Response");
    }
    String newEnum =
        enumText.substring(0, separator)
            + ",\n"
            + String.join(",\n", constants)
            + ";"
            + enumText.substring(separator + 1);
    for (String provider : List.of("postgresql", "mysql")) {
      Path migrations = root.resolve("src/main/resources/db/migration/" + provider);
      int next;
      try (var list = Files.list(migrations)) {
        next =
            list.map(p -> p.getFileName().toString())
                    .filter(p -> p.matches("V[0-9]+__.*"))
                    .mapToInt(p -> Integer.parseInt(p.substring(1, p.indexOf("__"))))
                    .max()
                    .orElse(0)
                + 1;
      }
      String
          uuid =
              provider.equals("mysql") ? "CHAR(36) CHARACTER SET ascii COLLATE ascii_bin" : "UUID",
          time = provider.equals("mysql") ? "DATETIME(6)" : "TIMESTAMPTZ";
      output.put(
          migrations.resolve("V" + next + "__" + route + ".sql"),
          "CREATE TABLE "
              + route
              + " (id "
              + uuid
              + " PRIMARY KEY,name VARCHAR(160) NOT NULL,created_at "
              + time
              + " NOT NULL,updated_at "
              + time
              + " NOT NULL)"
              + (provider.equals("mysql") ? " ENGINE=InnoDB" : "")
              + ";\nINSERT INTO permissions(id,name,created_at,updated_at) VALUES('"
              + UUID.randomUUID()
              + "','manage_"
              + route
              + "',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);\n");
    }
    for (Path path : output.keySet()) {
      if (!path.normalize().startsWith(root) || Files.exists(path))
        throw new IllegalArgumentException("Generator refuses overwrite");
    }
    for (var entry : output.entrySet()) {
      Files.createDirectories(entry.getKey().getParent());
      Files.writeString(entry.getKey(), entry.getValue(), StandardOpenOption.CREATE_NEW);
    }
    Files.writeString(enumFile, newEnum);
    String json = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(manifest) + "\n";
    Files.writeString(registryFile, json);
    Files.writeString(root.resolve("contracts/endpoints.json"), json);
    System.out.println(
        "Generated "
            + name
            + " with provider migration drafts. Review migrations, build, migrate and grant manage_"
            + route
            + " explicitly.");
  }
}
