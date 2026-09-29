import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";
import type { AppConfig } from "../../config/env.validation";

@Injectable()
export class MailService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}
  async send(input: { to: string; subject: string; text: string }): Promise<void> {
    if (!this.config.get("SMTP_ENABLED", { infer: true })) throw new ServiceUnavailableException("SMTP is disabled");
    const host = this.config.get("SMTP_HOST", { infer: true });
    const from = this.config.get("SMTP_FROM", { infer: true });
    if (!host || !from) throw new ServiceUnavailableException("SMTP is not configured");
    const user = this.config.get("SMTP_USER", { infer: true });
    const password = this.config.get("SMTP_PASSWORD", { infer: true });
    const transport = nodemailer.createTransport({ host, port: this.config.get("SMTP_PORT", { infer: true }),
      secure: this.config.get("SMTP_PORT", { infer: true }) === 465,
      // Email is sent inside the request, so bound every SMTP phase well below client timeouts.
      connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 10_000,
      ...(user && password ? { auth: { user, pass: password } } : {}) });
    try { await transport.sendMail({ from, to: input.to, subject: input.subject, text: input.text }); }
    finally { transport.close(); }
  }
}
