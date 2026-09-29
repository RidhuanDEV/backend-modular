import { BadRequestException, Injectable } from "@nestjs/common";

@Injectable()
export class TimeService {
  now(): Date { return new Date(); }
  isoUtc(instant: Date): string { return instant.toISOString(); }

  parseInstant(value: string): Date {
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new BadRequestException("Instant must include a time zone offset");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException("Invalid instant");
    return parsed;
  }

  formatInZone(instant: Date, zone: string): string {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      }).format(instant);
    } catch { throw new BadRequestException("Invalid IANA time zone"); }
  }
}
