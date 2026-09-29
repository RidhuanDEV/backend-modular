import { z } from "zod";

// Emails are compared case-insensitively; normalize before validation and storage.
export const emailField = (message = "Invalid email address") =>
  z.string().trim().toLowerCase().email(message);

// bcrypt ignores bytes after 72, so longer passwords would silently collide.
export const newPasswordField = () =>
  z
    .string()
    .min(6, "Password must be at least 6 characters")
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 bytes");

export const registerSchema = z.object({
  email: emailField(),
  password: newPasswordField(),
});

export const loginSchema = z.object({
  email: emailField(),
  password: z.string().min(1, "Password is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = refreshSchema;

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
export type LogoutDto = z.infer<typeof logoutSchema>;
