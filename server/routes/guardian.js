// Parent or guardian consent for applicants under 13. The guardian is emailed a link holding a
// random token (stored only as a hash) and consents or declines on a plain page, without an
// account. An under-13 application cannot be approved until the guardian has consented.
import express, { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { q, tx, now, audit } from '../db.js';
import { NATION, PUBLIC_URL, PRIVATE_DIR } from '../config.js';
import { sendMail } from '../mail.js';
import { rateLimit } from '../util.js';

const r = Router();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (ms) => new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/** Emails the guardian a fresh consent link (any earlier link stops working). Returns the link. */
export async function askGuardian(appId) {
  const a = q.get('SELECT a.*, u.username FROM applications a JOIN users u ON u.id = a.user_id WHERE a.id = ?', appId);
  const token = crypto.randomBytes(24).toString('base64url');
  q.run('UPDATE applications SET guardian_token = ? WHERE id = ?', sha256(token), appId);
  const link = `${PUBLIC_URL}/guardian/${token}`;
  await sendMail(a.guardian_email, `${a.legal_name} wants to join ${NATION.short}: your consent is needed`,
    `Hello ${a.guardian_name},

${a.legal_name} (account @${a.username}) has applied to become a citizen of ${NATION.name}, an online community, and gave your email address as their parent or guardian. Because they are under 13, their application cannot be approved without your permission.

Please read what joining involves, then give or refuse consent here:
${link}

If you don't know about this, you can refuse at the link or simply ignore this email: the application will not be approved without you.`);
  return link;
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(NATION.short)}</title><style>
body{margin:0;background:#f4f2ee;color:#1c2333;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:640px;margin:0 auto;padding:40px 16px}.card{background:#fff;border:1px solid #e3ded4;border-radius:12px;padding:28px}
h1{font-size:1.5rem;margin:0 0 12px}h2{font-size:1.05rem;margin:22px 0 6px}ul{padding-left:20px;margin:6px 0}.muted{color:#5b6475}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}button{font:inherit;padding:10px 20px;border-radius:8px;border:1px solid #c9c2b4;background:#fff;cursor:pointer}
button.primary{background:#1f4e8c;border-color:#1f4e8c;color:#fff}.ok{color:#1d7a46}.bad{color:#a3302a}
</style></head><body><main><div class="card">${body}</div><p class="muted" style="text-align:center;font-size:.9rem">${esc(NATION.name)} · Department of Citizenship &amp; Identity</p></main></body></html>`;

const find = (token) => q.get(`SELECT a.*, u.username, u.display_name FROM applications a JOIN users u ON u.id = a.user_id
  WHERE a.guardian_token = ? ORDER BY a.id DESC LIMIT 1`, sha256(String(token)));

r.use(express.urlencoded({ extended: false, limit: '2kb' }));

r.get('/:token', (req, res) => {
  rateLimit(`guardian:${req.ip}`, 30, 10 * 60e3);
  const a = find(req.params.token);
  res.setHeader('Cache-Control', 'no-store');
  if (!a) return res.status(404).send(page('Link not valid', '<h1>This link is not valid</h1><p>It may have been replaced by a newer email. Use the most recent link you received.</p>'));
  if (a.guardian_consent_at) return res.send(page('Consent given', `<h1 class="ok">Consent given</h1><p>You gave consent on ${date(a.guardian_consent_at)}. To withdraw it, reply to the email you received.</p>`));
  if (a.guardian_declined_at || a.status !== 'pending') return res.send(page('Application closed', '<h1>This application is closed</h1><p>Nothing more is needed from you.</p>'));
  res.send(page('Parent or guardian consent', `
    <h1>${esc(a.legal_name)} wants to become a citizen of ${esc(NATION.name)}</h1>
    <p>Hello ${esc(a.guardian_name)}. ${esc(NATION.name)} is an online community with its own government, laws, forum and marketplace. Because ${esc(a.legal_name)} is under 13, their application needs your permission.</p>
    <h2>What they have given us</h2>
    <ul><li>Their legal name, date of birth and email address</li><li>A photo of an identity document and a selfie, used only to check they are a real, unique person</li></ul>
    <p class="muted">These are seen only by citizenship registrars and are <b>never published</b>.</p>
    <h2>What other people can see</h2>
    <ul><li>Their account name (@${esc(a.username)}) and display name (${esc(a.display_name)})</li><li>Anything they post in the public forum or list in the marketplace</li></ul>
    <h2>Good to know</h2>
    <ul><li>Citizens receive ${NATION.citizenshipGrant} ${esc(NATION.currency.plural)}, a collectible currency with <b>no cash value</b>. Nothing on the site costs real money.</li>
      <li>Under the Minors Protection Act, nobody may ask a young citizen for personal information, images or off-site contact.</li>
      <li>You can withdraw consent at any time by replying to the email you received. Their account is then closed and their identity documents deleted.</li></ul>
    <form method="post"><div class="row">
      <button class="primary" name="choice" value="consent">I am their parent or guardian, and I consent</button>
      <button name="choice" value="decline">I do not consent</button></div></form>`));
});

r.post('/:token', (req, res) => {
  rateLimit(`guardian:${req.ip}`, 30, 10 * 60e3);
  const a = find(req.params.token);
  res.setHeader('Cache-Control', 'no-store');
  if (!a || a.status !== 'pending' || a.guardian_consent_at || a.guardian_declined_at) return res.redirect(303, req.originalUrl);
  if (req.body.choice === 'consent') {
    q.run('UPDATE applications SET guardian_consent_at = ? WHERE id = ?', now(), a.id);
    audit(a.user_id, 'guardian_consent', { application: a.id });
    return res.send(page('Thank you', `<h1 class="ok">Thank you</h1><p>${esc(a.legal_name)}'s application now goes to a citizenship registrar for review. To withdraw consent later, reply to the email you received.</p>`));
  }
  if (req.body.choice !== 'decline') return res.redirect(303, req.originalUrl);
  tx(() => {
    q.run("UPDATE applications SET status = 'rejected', guardian_declined_at = ?, review_note = 'Your parent or guardian did not give consent.', reviewed_at = ? WHERE id = ?", now(), now(), a.id);
    q.run("UPDATE users SET status = 'rejected' WHERE id = ? AND status = 'review'", a.user_id);
  });
  // The documents were only ever needed for this application.
  for (const f of [a.doc_image, a.selfie_image]) fs.rm(path.join(PRIVATE_DIR, path.basename(f)), { force: true }, () => {});
  audit(a.user_id, 'guardian_declined', { application: a.id });
  res.send(page('Consent refused', `<h1>Consent refused</h1><p>The application has been closed and ${esc(a.legal_name)}'s identity document and selfie have been deleted.</p>`));
});

export default r;
