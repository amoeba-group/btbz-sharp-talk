import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveMailFrom } from './alert-address.util';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Outbound email (escalation summaries, off-hours replies to shoppers).
 *
 * Deliberately best-effort: a mail failure must never break the conversation
 * it belongs to, so every path returns a boolean instead of throwing, and an
 * unconfigured SMTP host is a silent no-op rather than an error — staging ran
 * for weeks without one.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly config: ConfigService) {}

  /** True when an SMTP host is configured, i.e. sending can be attempted. */
  configured(): boolean {
    return !!this.config.get<string>('SMTP_HOST');
  }

  /** Sends one message. Returns false (with a warning) on any failure. */
  async send(mail: MailMessage): Promise<boolean> {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host || !mail.to) return false;
    try {
      // Imported lazily so the API still typechecks and boots where the
      // optional dependency is absent.
      const nodemailer = (await import('nodemailer' as string).catch(() => null)) as {
        createTransport: (opts: unknown) => { sendMail: (mail: unknown) => Promise<unknown> };
      } | null;
      if (!nodemailer) {
        this.logger.warn('Email skipped: nodemailer not installed (run npm install)');
        return false;
      }
      const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
      const user = this.config.get<string>('SMTP_USER');
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass: this.config.get<string>('SMTP_PASS') } : undefined,
      });
      await transport.sendMail({
        // Blank-safe and never Amoeba's: see resolveMailFrom (PLN-261012 SG-80).
        from: resolveMailFrom({
          from: this.config.get<string>('ALERT_EMAIL_FROM'),
          smtpUser: user,
          appPublicUrl: this.config.get<string>('APP_PUBLIC_URL'),
        }),
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
      return true;
    } catch (e) {
      // Recipient addresses are personal data — log the failure, not the target.
      this.logger.warn(`Email send failed: ${(e as Error).message}`);
      return false;
    }
  }
}
