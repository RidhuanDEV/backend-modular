import { ValidateBy, type ValidationOptions } from "class-validator";

/** bcrypt ignores bytes after 72, so longer passwords would silently collide. */
export function MaxUtf8Bytes(max: number, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy({
    name: "maxUtf8Bytes",
    constraints: [max],
    validator: {
      validate: (value: unknown) => typeof value === "string" && Buffer.byteLength(value, "utf8") <= max,
      defaultMessage: () => `password must be at most ${max} bytes`,
    },
  }, options);
}
