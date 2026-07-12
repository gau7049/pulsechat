import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Transactional email via the Brevo REST API (Technical Spec §1).
 * Dev fallback: without BREVO_API_KEY, the email (including its action link
 * or code) is logged to the console so flows remain fully testable locally.
 */

interface EmailMessage {
  to: string;
  subject: string;
  heading: string;
  bodyLines: string[];
  /** Button target, if the email carries an action link. */
  actionUrl?: string;
  actionLabel?: string;
}

const FROM = { name: 'PulseChat', email: 'noreply@pulsechat.app' };

function renderHtml(message: EmailMessage): string {
  const paragraphs = message.bodyLines
    .map(
      (line) => `<p style="margin:0 0 12px;color:#333;font-size:15px;line-height:1.6">${line}</p>`,
    )
    .join('');
  const button = message.actionUrl
    ? `<a href="${message.actionUrl}" style="display:inline-block;margin-top:8px;background:#6d4aff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600">${message.actionLabel ?? 'Open PulseChat'}</a>`
    : '';
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
    <h1 style="font-size:20px;color:#111;margin:0 0 16px">${message.heading}</h1>
    ${paragraphs}${button}
    <p style="margin-top:24px;color:#999;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
  </div>`;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!env.BREVO_API_KEY) {
    logger.warn(
      {
        event: 'email.console_fallback',
        to: message.to,
        subject: message.subject,
        actionUrl: message.actionUrl,
        bodyLines: message.bodyLines,
      },
      `BREVO_API_KEY unset — email NOT sent. Action link/code is in this log entry.`,
    );
    return;
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: FROM,
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: renderHtml(message),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    // Email failures must never break the auth flow — log and continue; the
    // user can use the resend affordance.
    logger.error(
      { event: 'email.send_failed', to: message.to, status: response.status, detail },
      'Brevo send failed',
    );
    return;
  }
  logger.info({ event: 'email.sent', to: message.to, subject: message.subject }, 'email sent');
}

// ── Message builders (the only place email copy lives) ──────────────────────

export function verificationEmail(to: string, link: string): EmailMessage {
  return {
    to,
    subject: 'Verify your email for PulseChat',
    heading: 'Confirm your email address',
    bodyLines: ['Tap the button below to verify this email for your PulseChat account.'],
    actionUrl: link,
    actionLabel: 'Verify email',
  };
}

export function magicLinkEmail(to: string, link: string): EmailMessage {
  return {
    to,
    subject: 'Your PulseChat sign-in link',
    heading: 'Sign in with one tap',
    bodyLines: [
      'Use the button below to sign in to PulseChat. The link works once and expires in 15 minutes.',
    ],
    actionUrl: link,
    actionLabel: 'Sign in to PulseChat',
  };
}

export function otpEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your PulseChat code`,
    heading: 'Your verification code',
    bodyLines: [
      `Enter this code to finish signing in: <strong style="font-size:22px;letter-spacing:4px">${code}</strong>`,
      'The code expires in 10 minutes.',
    ],
  };
}

export function newDeviceEmail(to: string, link: string, deviceInfo: string): EmailMessage {
  return {
    to,
    subject: 'New device sign-in attempt on PulseChat',
    heading: 'Was this you?',
    bodyLines: [
      `A sign-in was attempted from an unrecognized device: <strong>${deviceInfo}</strong>.`,
      'If this was you, confirm below. If not, change your password now.',
    ],
    actionUrl: link,
    actionLabel: "Yes, it's me",
  };
}

export function passwordResetEmail(to: string, link: string): EmailMessage {
  return {
    to,
    subject: 'Reset your PulseChat password',
    heading: 'Password reset',
    bodyLines: [
      'Tap the button below to choose a new password. The link works once and expires in 30 minutes.',
    ],
    actionUrl: link,
    actionLabel: 'Reset password',
  };
}

export function accountRestoreEmail(to: string, link: string): EmailMessage {
  return {
    to,
    subject: 'Restore your PulseChat account',
    heading: 'Restore your account',
    bodyLines: [
      'Tap the button below to restore your deleted PulseChat account. The link works once and expires in 30 minutes.',
      'After restoring, sign in as usual.',
    ],
    actionUrl: link,
    actionLabel: 'Restore account',
  };
}
