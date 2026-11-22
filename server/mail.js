// Outgoing mail. Set SMTP_URL (e.g. smtps://you%40gmail.com:app-password@smtp.gmail.com:465)
// and MAIL_FROM to send real email; without it messages are only printed to the server log.
import nodemailer from 'nodemailer';
import { NATION } from './config.js';

const transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
const FROM = process.env.MAIL_FROM || `${NATION.short} <no-reply@localhost>`;

export const mailConfigured = !!transport;

export async function sendMail(to, subject, text) {
  if (!transport) { console.log(`[mail] to=${to} subject="${subject}"\n${text}`); return; }
  try {
    await transport.sendMail({ from: FROM, to, subject, text });
  } catch (e) {
    console.error(`[mail] could not send to ${to}: ${e.message}`);
    throw Object.assign(new Error('The verification email could not be sent — try again shortly'), { status: 503 });
  }
}
