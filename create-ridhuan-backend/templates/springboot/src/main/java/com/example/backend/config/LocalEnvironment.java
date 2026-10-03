package com.example.backend.config;

import io.github.cdimascio.dotenv.internal.DotenvParser;
import io.github.cdimascio.dotenv.internal.DotenvReader;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Pattern;
import tools.jackson.databind.json.JsonMapper;

public final class LocalEnvironment {
  private LocalEnvironment() {}

  private static final Pattern QUOTED =
      Pattern.compile("^\\s*([A-Za-z_][A-Za-z0-9_.-]*)\\s*=\\s*(['\"])(.*)$");

  public static Map<String, String> load(Path directory) {
    try {
      Path file = directory.resolve(".env");
      if (!Files.exists(file)) return Map.of();
      var mapper = JsonMapper.builder().build();
      List<String> normalized = new ArrayList<>();
      Map<String, String> quoted = new HashMap<>();
      // dotenv-java 3.2.0 does not decode single quotes or escaped quote/hash pairs.
      // Canonicalize those scalars; its pinned parser still owns keys/comments/syntax.
      for (String line : Files.readAllLines(file)) {
        var match = QUOTED.matcher(line);
        if (!match.matches()) {
          normalized.add(line);
          continue;
        }
        char quote = match.group(2).charAt(0);
        String tail = match.group(3);
        int end = -1;
        for (int index = 0; index < tail.length(); index++) {
          char character = tail.charAt(index);
          if (character == '\\') {
            index++;
            continue;
          }
          if (character == quote) {
            end = index;
            break;
          }
        }
        if (end < 0) throw new IllegalArgumentException();
        String suffix = tail.substring(end + 1).trim();
        if (!suffix.isEmpty() && !suffix.startsWith("#")) throw new IllegalArgumentException();
        String raw = tail.substring(0, end);
        String value =
            quote == '\''
                ? raw.replace("\\'", "'")
                : mapper.readValue("\"" + raw.replace("\\$", "$") + "\"", String.class);
        String token = "RIDHUAN_QUOTED_" + normalized.size();
        quoted.put(match.group(1) + "=" + token, value);
        normalized.add(match.group(1) + "=" + token);
      }
      var reader =
          new DotenvReader(directory.toString(), ".env") {
            @Override
            public List<String> read() {
              return normalized;
            }
          };
      Map<String, String> values = new HashMap<>();
      for (var entry : new DotenvParser(reader, true, true).parse())
        values.put(
            entry.getKey(),
            quoted.getOrDefault(entry.getKey() + "=" + entry.getValue(), entry.getValue()));
      return values;
    } catch (Exception failure) {
      throw new IllegalArgumentException("Invalid local .env syntax");
    }
  }
}
