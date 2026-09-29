/**
 * Env replacement only rewrites keys that already exist in .env.example, so a
 * renamed template key would otherwise be dropped silently and leave a default
 * credential in place. Fail the scaffold instead.
 */
export function assertEnvKeysExist(templateContent: string, replacements: Record<string, string>): void {
  const present = new Set(
    templateContent
      .split(/\r?\n/)
      .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((key): key is string => key !== undefined),
  );
  const missing = Object.keys(replacements).filter((key) => !present.has(key));
  if (missing.length > 0) {
    throw new Error(`Template .env.example is missing expected keys: ${missing.join(", ")}`);
  }
}
