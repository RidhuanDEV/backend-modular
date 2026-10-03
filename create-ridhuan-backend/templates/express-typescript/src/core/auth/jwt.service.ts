import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { JwtUserPayload } from "../../types/index.js";

// Pin algorithm, issuer and audience so tokens minted for another service or with another algorithm are rejected.
const signOptions = {
  algorithm: "HS256",
  expiresIn: "15m",
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
} as const satisfies jwt.SignOptions;

export function signToken(payload: JwtUserPayload): string {
  return jwt.sign(
    { ...payload, tokenUse: "access" },
    env.JWT_SECRET,
    signOptions,
  );
}

export function verifyToken(token: string): JwtUserPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });

  if (
    decoded &&
    typeof decoded === "object" &&
    decoded["tokenUse"] === "access" &&
    "id" in decoded &&
    "email" in decoded &&
    "roleId" in decoded
  ) {
    if (
      typeof decoded["id"] === "string" &&
      typeof decoded["email"] === "string" &&
      typeof decoded["roleId"] === "string"
    ) {
      return {
        id: decoded["id"],
        email: decoded["email"],
        roleId: decoded["roleId"],
        ...(typeof decoded["exp"] === "number" ? { exp: decoded["exp"] } : {}),
      };
    }
  }

  throw new Error("Invalid token payload structure");
}
