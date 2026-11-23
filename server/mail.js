// Outgoing mail, by either:
//   Gmail OAuth   GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
//                 (get them with `npm run gmail-oauth`; works where app passwords are refused)
//   any SMTP      SMTP_URL, e.g. smtps://you%40gmail.com:app-password@smtp.gmail.com:465
// MAIL_FROM sets the sender name. Without either, messages are only printed to the server log.
import nodemailer from 'nodemailer';
import { NATION } from './config.js';

const env = process.env;
const gmail = env.GMAIL_USER && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN;
const transport = gmail
  ? nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { type: 'OAuth2', user: env.GMAIL_USER, clientId: env.GMAIL_CLIENT_ID, clientSecret: env.GMAIL_CLIENT_SECRET, refreshToken: env.GMAIL_REFRESH_TOKEN },
  })
  : env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;
const FROM = env.MAIL_FROM || (gmail ? `${NATION.short} <${env.GMAIL_USER}>` : `${NATION.short} <no-reply@localhost>`);

export const mailConfigured = !!transport;
/** Resolves if the mail server accepts our login (sends nothing). */
export const verifyMail = () => (transport ? transport.verify() : Promise.reject(new Error('Mail is not configured')));

export async function sendMail(to, subject, text) {
  if (!transport) { console.log(`[mail] to=${to} subject="${subject}"\n${text}`); return; }
  try {
    await transport.sendMail({ from: FROM, to, subject, text });
  } catch (e) {
    console.error(`[mail] could not send to ${to}: ${e.message}`);
    throw Object.assign(new Error('The verification email could not be sent — try again shortly'), { status: 503 });
  }
}
