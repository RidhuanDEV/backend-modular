import { z } from "zod";

function splitFields(value: string): string[] {
  return value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

/**
 * `?fields=` restricted to an allowlist of response fields. Unknown names are a
 * validation error (400) instead of being silently ignored.
 */
export function fieldsQuery<K extends string>(allowed: readonly K[]) {
  const list = allowed.join(", ");
  return z
    .string()
    .max(255)
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        splitFields(value).every((field) =>
          allowed.some((name) => name === field),
        ),
      { message: `fields must be a comma-separated subset of: ${list}` },
    )
    .describe(
      `Comma-separated response fields to return (allowed: ${list}). Omit for the full object.`,
    );
}

/** The allowlisted keys named in `?fields=`, or undefined for the full object. */
export function selectedFields<K extends string>(
  value: string | undefined,
  allowed: readonly K[],
): K[] | undefined {
  if (value === undefined) return undefined;
  const requested = splitFields(value);
  const keys = allowed.filter((name) => requested.includes(name));
  return keys.length > 0 ? keys : undefined;
}

/** Keeps only the selected keys of a response object. */
export function projectFields<T, K extends keyof T>(
  value: T,
  keys: readonly K[] | undefined,
): Partial<T> {
  if (!keys) return value;
  const projected: Partial<T> = {};
  for (const key of keys) projected[key] = value[key];
  return projected;
}
