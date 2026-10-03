package com.example.backend.platform.time;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;

public final class Zones {
  private Zones() {}

  public static ZonedDateTime present(Instant instant, String zone) {
    return instant.atZone(
        ZoneId.of(
            switch (zone) {
              case "WIB" -> "Asia/Jakarta";
              case "WITA" -> "Asia/Makassar";
              case "WIT" -> "Asia/Jayapura";
              default -> zone;
            }));
  }
}
