import { Router } from 'express';
import crypto from 'node:crypto';
import { q, tx, now, audit, gazette } from '../db.js';
import { NATION, SECURITY, DEV, PRIVATE_DIR } from '../config.js';
import {
  hashPassword, verifyPassword, burnPasswordCheck, identityHmac, sha256, randomToken,
  validatePublicKey, keyId, epochInfo, issueChallenge,
} from '../security.js';
import { createSession, destroySession, requireAuth, requireCitizen, requirePassport, requireAccess, publicUser } from '../auth.js';
import { h, str, bad, forbidden, rateLimit, memoryUpload, saveImage, oneOf } from '../util.js';
import { grantCitizenship, registerWallet, balance } from '../ledger.js';
import { verifyLink } from '../chain.js';
import { sendMail } from '../mail.js';
import { askGuardian } from './guardian.js';
import { newPassportNumber, passportSvg, extractToken, readPassportToken } from '../passport.js';

const r = Router();
const USERNAME = /^[a-zA-Z][a-zA-Z0-9_]{2,23}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw bad('Password must be at least 10 characters');
  if (pw.length > 200) throw bad('Password is too long');
  if (!/[a-zA-Z]/.test(pw) || !/[^a-zA-Z]/.test(pw)) throw bad('Password must mix letters with numbers or symbols');
}

async function sendEmailCode(user) {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  q.run('INSERT OR REPLACE INTO email_codes (user_id, code_hash, expires_at, attempts) VALUES (?,?,?,0)', user.id, sha256(code), now() + 15 * 60e3);
  await sendMail(user.email, `Your ${NATION.short} verification code`,
    `Your ${NATION.short} verification code is ${code}

It expires in 15 minutes. If you did not apply for ${NATION.demonym} citizenship, ignore this email.`);
  return code;
}

export function me(req) {
  const u = req.user;
  if (!u) return { user: null, nation: NATION, epoch: epochInfo() };
  return {
    user: {
      ...publicUser(u), email: u.email, emailVerified: !!u.email_verified, legalName: u.legal_name,
      hasKey: !!u.public_key, keyId: u.key_id, chainAddress: u.chain_address, keyReissue: u.key_reissue, passportVersion: u.passport_version,
    },
    wallet: u.status === 'citizen' ? balance(u.id) : null,
    elevation: { passportUntil: req.sess?.passport_until || 0 },
    nation: NATION,
    epoch: epochInfo(),
  };
}

r.get('/me', (req, res) => res.json(me(req)));

r.post('/register', h(async (req, res) => {
  rateLimit(`register:${req.ip}`, 5, 60 * 60e3);
  const username = str(req.body.username, 'Account name', { min: 3, max: 24, pattern: USERNAME });
  const displayName = str(req.body.displayName, 'Display name', { min: 2, max: 40 });
  const email = str(req.body.email, 'Email', { max: 200, pattern: EMAIL }).toLowerCase();
  checkPasswordStrength(req.body.password);
  if (q.get('SELECT 1 FROM users WHERE username = ?', username)) throw bad('That account name is taken');
  if (q.get('SELECT 1 FROM users WHERE email = ?', email)) throw bad('An account already exists for that email. Each person may hold only one account.');
  const pw = await hashPassword(req.body.password);
  const info = q.run('INSERT INTO users (username, email, pw_hash, display_name, created_at) VALUES (?,?,?,?,?)', username, email, pw, displayName, now());
  const user = q.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
  const code = await sendEmailCode(user);
  createSession(req, res, user.id);
  audit(user.id, 'register', { ip: req.ip });
  res.json({ ok: true, devCode: DEV ? code : undefined });
}));

r.post('/verify-email', requireAuth, h(async (req, res) => {
  const row = q.get('SELECT * FROM email_codes WHERE user_id = ?', req.user.id);
  if (!row || row.expires_at < now()) throw bad('Code expired — request a new one');
  if (row.attempts >= 5) throw bad('Too many wrong codes — request a new one');
  if (sha256(String(req.body.code || '').trim()) !== row.code_hash) {
    q.run('UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = ?', req.user.id);
    throw bad('Incorrect code');
  }
  q.run('DELETE FROM email_codes WHERE user_id = ?', req.user.id);
  q.run("UPDATE users SET email_verified = 1, status = CASE WHEN status = 'email' THEN 'documents' ELSE status END WHERE id = ?", req.user.id);
  res.json({ ok: true });
}));

r.post('/resend-code', requireAuth, h(async (req, res) => {
  if (req.user.email_verified) throw bad('Email already verified');
  rateLimit(`resend:${req.user.id}`, 3, 15 * 60e3);
  const code = await sendEmailCode(req.user);
  res.json({ ok: true, devCode: DEV ? code : undefined });
}));

r.post('/login', h(async (req, res) => {
  rateLimit(`login:${req.ip}`, 10, 10 * 60e3);
  const user = q.get('SELECT * FROM users WHERE username = ?', String(req.body.username || '').trim());
  if (!user) { await burnPasswordCheck(req.body.password); throw bad('Account name or password is incorrect'); }
  rateLimit(`login-user:${user.id}`, 8, 10 * 60e3);
  if (!(await verifyPassword(req.body.password || '', user.pw_hash))) throw bad('Account name or password is incorrect');
  if (user.status === 'banned') throw forbidden('This account has been closed by the Department of Citizenship');
  createSession(req, res, user.id);
  audit(user.id, 'login', { ip: req.ip });
  res.json({ ok: true });
}));

r.post('/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });

// ---------------------------------------------------------------- citizenship application
const LIVENESS_WORDS = ['harbor', 'lantern', 'orchid', 'granite', 'falcon', 'meadow', 'copper', 'willow', 'ember', 'summit', 'river', 'cedar', 'atlas', 'comet', 'prairie', 'quartz'];

r.get('/liveness', requireAuth, (req, res) => {
  if (!['documents', 'rejected'].includes(req.user.status)) throw bad('No application in progress');
  const words = Array.from({ length: 2 }, () => LIVENESS_WORDS[crypto.randomInt(LIVENESS_WORDS.length)]);
  const fingers = 1 + crypto.randomInt(5);
  const phrase = `Hold up ${fingers} finger${fingers > 1 ? 's' : ''} and show a note reading “${words.join(' ').toUpperCase()} ${crypto.randomInt(10, 99)}”`;
  q.run('INSERT OR REPLACE INTO liveness (user_id, phrase, expires_at) VALUES (?,?,?)', req.user.id, phrase, now() + 30 * 60e3);
  res.json({ phrase });
});

const appUpload = memoryUpload(8, 2).fields([{ name: 'document', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);

r.post('/application', requireAuth, appUpload, h(async (req, res) => {
  if (!req.user.email_verified) throw bad('Verify your email first');
  if (!['documents', 'rejected'].includes(req.user.status)) throw bad('You already have an application on file');
  rateLimit(`apply:${req.user.id}`, 5, 24 * 3600e3);
  const live = q.get('SELECT * FROM liveness WHERE user_id = ? AND expires_at > ?', req.user.id, now());
  if (!live) throw bad('Your liveness prompt expired — reload the page to get a new one');
  const legalName = str(req.body.legalName, 'Legal name', { min: 3, max: 100 });
  const dob = str(req.body.dob, 'Date of birth', { pattern: /^\d{4}-\d{2}-\d{2}$/ });
  const age = (now() - Date.parse(dob)) / (365.25 * 864e5);
  if (!(age > 0 && age < 125)) throw bad('Enter your real date of birth');
  // Under 13, a parent or guardian must consent by email before approval (Minors Protection Act).
  let guardian = null;
  if (age < 13) {
    guardian = {
      name: str(req.body.guardianName, "Parent or guardian's name", { min: 3, max: 100 }),
      email: str(req.body.guardianEmail, "Parent or guardian's email", { max: 200, pattern: EMAIL }).toLowerCase(),
    };
    if (guardian.email === req.user.email) throw bad('Your parent or guardian must use their own email address, not yours');
  }
  const country = str(req.body.country, 'Issuing country', { min: 2, max: 56 });
  const docType = oneOf(req.body.docType, 'Document type', ['passport', 'national_id', 'drivers_license', 'student_id', 'birth_certificate']);
  const docNumber = str(req.body.docNumber, 'Document number', { min: 4, max: 30 });
  const doc = req.files?.document?.[0];
  const selfie = req.files?.selfie?.[0];
  if (!doc || !selfie) throw bad('Both a photo of your ID document and a selfie are required');
  const dhash = /^[0-9a-f]{16}$/.test(req.body.dhash || '') ? req.body.dhash : null;

  const docHmac = identityHmac('doc', country, docType, docNumber);
  const personHmac = identityHmac('person', legalName, dob);
  const ipHmac = identityHmac('ip', req.ip || '');

  // Duplicate-person signals. A document that already backs an account is a hard stop;
  // the rest are surfaced to the human reviewer.
  const dupDoc = q.get("SELECT user_id FROM applications WHERE doc_hmac = ? AND status IN ('pending','approved','banned')", docHmac);
  if (dupDoc) {
    audit(req.user.id, 'duplicate_document_attempt', { other: dupDoc.user_id });
    throw bad('This identity document is already registered to a citizen. Each person may hold only one account.');
  }
  const flags = [];
  const samePerson = q.all("SELECT user_id FROM applications WHERE person_hmac = ? AND user_id != ? AND status IN ('pending','approved','banned')", personHmac, req.user.id);
  if (samePerson.length) flags.push({ code: 'same_name_dob', detail: `Same legal name + date of birth as user(s) ${samePerson.map((s) => s.user_id).join(', ')}` });
  const sameIp = q.get("SELECT COUNT(DISTINCT user_id) c FROM applications WHERE ip_hmac = ? AND user_id != ? AND created_at > ?", ipHmac, req.user.id, now() - 30 * 864e5).c;
  if (sameIp) flags.push({ code: 'shared_network', detail: `${sameIp} other application(s) from the same network in 30 days` });
  if (dhash) {
    const near = q.all("SELECT user_id, selfie_dhash FROM applications WHERE selfie_dhash IS NOT NULL AND user_id != ? AND status IN ('pending','approved')", req.user.id)
      .filter((a) => hamming(a.selfie_dhash, dhash) <= 8);
    if (near.length) flags.push({ code: 'similar_selfie', detail: `Selfie resembles user(s) ${near.map((n) => n.user_id).join(', ')} (perceptual hash — weak signal, compare visually)` });
  }
  if (guardian) flags.push({ code: 'under_13', detail: `Applicant is under 13. ${guardian.name} (${guardian.email}) must consent by email before approval.` });
  if (docType === 'birth_certificate') flags.push({ code: 'no_photo_document', detail: 'A birth certificate has no photo, so the selfie cannot be matched to the document' });
  const live_capture = req.body.liveCapture === '1';
  if (!live_capture) flags.push({ code: 'uploaded_selfie', detail: 'Selfie was uploaded from a file, not captured live' });

  const docName = saveImage(doc.buffer, PRIVATE_DIR);
  const selfieName = saveImage(selfie.buffer, PRIVATE_DIR);
  const appId = tx(() => {
    const info = q.run(`INSERT INTO applications (user_id, legal_name, dob, country, doc_type, doc_hmac, doc_last4, person_hmac, doc_image, selfie_image, live_capture, liveness_phrase, selfie_dhash, ip_hmac, flags, guardian_name, guardian_email, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    req.user.id, legalName, dob, country, docType, docHmac, docNumber.replace(/\W/g, '').slice(-4), personHmac, docName, selfieName,
    live_capture, live.phrase, dhash, ipHmac, JSON.stringify(flags), guardian?.name ?? null, guardian?.email ?? null, now());
    q.run("UPDATE users SET status = 'review', legal_name = ?, dob = ? WHERE id = ?", legalName, dob, req.user.id);
    q.run('DELETE FROM liveness WHERE user_id = ?', req.user.id);
    return Number(info.lastInsertRowid);
  });
  audit(req.user.id, 'application_submitted', { flags: flags.map((f) => f.code) });
  if (!guardian) return res.json({ ok: true });
  // The application is saved either way; a failed email can be resent from the status page.
  const link = await askGuardian(appId).catch(() => null);
  res.json({ ok: true, guardianEmailed: !!link, devGuardianLink: DEV ? link : undefined });
}));

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < 16; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}

r.get('/application', requireAuth, (req, res) => {
  const a = q.get(`SELECT id, legal_name, country, doc_type, status, review_note, created_at, reviewed_at, guardian_name, guardian_email, guardian_consent_at
    FROM applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`, req.user.id);
  res.json({ application: a || null });
});

r.post('/guardian/resend', requireAuth, h(async (req, res) => {
  const a = q.get("SELECT id FROM applications WHERE user_id = ? AND status = 'pending' AND guardian_email IS NOT NULL AND guardian_consent_at IS NULL ORDER BY id DESC LIMIT 1", req.user.id);
  if (!a) throw bad('No consent request is waiting');
  rateLimit(`guardian-resend:${req.user.id}`, 3, 60 * 60e3);
  const link = await askGuardian(a.id);
  res.json({ ok: true, devGuardianLink: DEV ? link : undefined });
}));

// ---------------------------------------------------------------- passport + .access key issuance
// The browser generates the ECDSA key pair, encrypts the private key with the account
// password into the .access file, and sends us only the public key.
r.post('/passport/issue', requireAuth, h(async (req, res) => {
  const u = req.user;
  const reissue = u.status === 'citizen' && u.key_reissue === 'allowed';
  if (u.status !== 'approved' && !reissue) throw bad('Your citizenship has not been approved yet');
  if (!(await verifyPassword(req.body.password || '', u.pw_hash))) throw bad('Password is incorrect — the .access file must be encrypted with your account password');
  const pk = String(req.body.publicKey || '');
  if (!validatePublicKey(pk)) throw bad('Invalid public key');
  // The Sigil wallet key is derived from the same .access key; the browser proves it holds it.
  const chainAddress = String(req.body.chainAddress || '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(chainAddress) || !verifyLink(u.username, keyId(pk), chainAddress, String(req.body.chainProof || ''))) throw bad('Invalid Aurum wallet proof');
  await registerWallet(u.id, chainAddress);
  const result = tx(() => {
    const passportNo = u.passport_no || newPassportNumber();
    q.run(`UPDATE users SET public_key = ?, key_id = ?, key_version = key_version + 1, key_reissue = 'none', chain_address = ?,
      passport_no = ?, passport_version = passport_version + 1, passport_issued_at = ?, status = 'citizen',
      citizen_since = COALESCE(citizen_since, ?) WHERE id = ?`, pk, keyId(pk), chainAddress, passportNo, now(), now(), u.id);
    if (reissue) gazette('passport', `Passport ${passportNo} reissued`, 'Previous passport images and .access key revoked; the citizen\'s Sigil wallet key was changed on-chain.', `user:${u.id}`);
    // Any earlier passport check on this session refers to the old passport.
    q.run('UPDATE sessions SET passport_until = 0 WHERE user_id = ?', u.id);
    return { passportNo };
  });
  let grant = null;
  if (!reissue) {
    grant = await grantCitizenship(u.id);
    gazette('citizenship', `Citizenship conferred on @${u.username}`, `Passport ${result.passportNo} issued. ${grant.count} ${NATION.currency.plural} worth ${grant.value} ${NATION.currency.symbol} minted on-chain to the new citizen (transaction ${grant.chainTx}).`, `user:${u.id}`);
  }
  result.grantValue = grant?.value || 0;
  result.chainTx = grant?.chainTx || null;
  audit(u.id, reissue ? 'passport_reissued' : 'passport_issued', result);
  res.json({ ok: true, ...result, keyId: keyId(pk), granted: reissue ? 0 : NATION.citizenshipGrant });
}));

r.get('/passport.svg', requireCitizen, h(async (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `inline; filename="passport-${req.user.passport_no}.svg"`);
  res.send(await passportSvg(req.user));
}));

const passportUpload = memoryUpload(6, 1).single('passport');
r.post('/passport/check', requireCitizen, passportUpload, h(async (req, res) => {
  rateLimit(`pcheck:${req.user.id}`, 10, 10 * 60e3);
  if (!req.file) throw bad('Choose your passport image (SVG or PNG)');
  const token = extractToken(req.file.buffer);
  if (!token) throw bad('No passport security token found in this image. Upload the passport SVG or PNG downloaded from your Passport page.');
  const p = readPassportToken(token);
  if (!p) throw forbidden('This passport has an invalid signature — it was not issued by this government');
  if (p.uid !== req.user.id || p.pn !== req.user.passport_no) throw forbidden('This passport belongs to a different citizen');
  if (p.v !== req.user.passport_version) throw forbidden('This passport image has been superseded by a reissued passport. Download your current one.');
  const until = now() + SECURITY.passportElevationSeconds * 1000;
  q.run('UPDATE sessions SET passport_until = ? WHERE id = ?', until, req.sessionId);
  audit(req.user.id, 'passport_check', null);
  res.json({ ok: true, passportUntil: until });
}));

r.post('/key/report-lost', requireCitizen, h(async (req, res) => {
  if (!(await verifyPassword(req.body.password || '', req.user.pw_hash))) throw bad('Password is incorrect');
  q.run("UPDATE users SET key_reissue = 'requested' WHERE id = ? AND key_reissue = 'none'", req.user.id);
  audit(req.user.id, 'key_reissue_requested', null);
  res.json({ ok: true });
}));

// Lets a citizen confirm their .access file works without doing anything consequential.
r.post('/key/test', requireAccess('account.keytest', (req) => req.body.params), (req, res) => {
  audit(req.user.id, 'key_test', null);
  res.json({ ok: true, keyId: req.user.key_id });
});

// ---------------------------------------------------------------- profile + password
r.patch('/profile', requirePassport, h(async (req, res) => {
  const displayName = str(req.body.displayName, 'Display name', { min: 2, max: 40 });
  const bio = str(req.body.bio, 'Bio', { max: 500, optional: true });
  q.run('UPDATE users SET display_name = ?, bio = ? WHERE id = ?', displayName, bio, req.user.id);
  res.json({ ok: true });
}));

// Changing the password re-encrypts the .access file client-side; the key pair itself is unchanged.
r.post('/password', requireAccess('account.password', () => ({})), h(async (req, res) => {
  checkPasswordStrength(req.body.newPassword);
  q.run('UPDATE users SET pw_hash = ? WHERE id = ?', await hashPassword(req.body.newPassword), req.user.id);
  q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.sessionId);
  audit(req.user.id, 'password_changed', null);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- secure-operation challenges
export const secure = Router();
const OPS = ['account.keytest', 'wallet.send', 'wallet.break', 'market.buy', 'bill.vote', 'account.password', 'admin.role', 'admin.status', 'citizenship.decide'];
secure.get('/epoch', (_req, res) => res.json(epochInfo()));
secure.post('/challenge', requireCitizen, (req, res) => {
  const op = oneOf(req.body.op, 'op', OPS);
  const params = req.body.params && typeof req.body.params === 'object' ? req.body.params : {};
  rateLimit(`challenge:${req.user.id}`, 30, 10 * 60e3);
  res.json({ ...issueChallenge(req.user.id, op, params), epochInfo: epochInfo() });
});

export default r;
