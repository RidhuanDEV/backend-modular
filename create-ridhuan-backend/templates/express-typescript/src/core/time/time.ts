import { z } from "zod";

/** Instants are stored and exchanged in UTC. A zone is needed only for presentation. */
export const instantSchema = z.iso.datetime({ offset: true });
export const timeZoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Invalid IANA time zone");

export function nowUtc(): Date {
  return new Date();
}
export function parseInstant(value: string): Date {
  const parsed = instantSchema.parse(value);
  const date = new Date(parsed);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid instant");
  return date;
}
export function toUtcIso(value: Date): string {
  return value.toISOString();
}
export function formatInZone(
  value: Date,
  zone: string,
  locale = "id-ID",
): string {
  const timeZone = timeZoneSchema.parse(zone);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).format(value);
}
