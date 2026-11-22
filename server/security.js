import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR, SECURITY } from './config.js';
import { q, now } from './db.js';

const scrypt = promisify(crypto.scrypt);
export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
export const randomToken = (bytes = 32) => b64url(crypto.randomBytes(bytes));

// ---------------------------------------------------------------- server keys
// master: root of the rotating epoch keys. pepper: keys identity-document HMACs.
// ed25519: long-term signing key for passports and ledger blocks.
const KEY_FILE = path.join(DATA_DIR, 'server-keys.json');
function loadKeys() {
  if (fs.existsSync(KEY_FILE)) return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const keys = {
    master: crypto.randomBytes(32).toString('hex'),
    pepper: crypto.randomBytes(32).toString('hex'),
    signPrivate: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    signPublic: publicKey.export({ type: 'spki', format: 'pem' }),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}
const KEYS = loadKeys();
const SIGN_PRIVATE = crypto.createPrivateKey(KEYS.signPrivate);
const SIGN_PUBLIC = crypto.createPublicKey(KEYS.signPublic);
export const SERVER_PUBLIC_PEM = KEYS.signPublic;
export const SERVER_KEY_FINGERPRINT = sha256(SIGN_PUBLIC.export({ type: 'spki', format: 'der' })).slice(0, 16);

export const serverSign = (data) => b64url(crypto.sign(null, Buffer.from(data), SIGN_PRIVATE));
export const serverVerify = (data, sig) => {
  try { return crypto.verify(null, Buffer.from(data), SIGN_PUBLIC, Buffer.from(sig, 'base64url')); } catch { return false; }
};

// ---------------------------------------------------------------- passwords
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(String(pw).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(expected, got);
}
// Constant-ish time dummy so unknown usernames take as long as wrong passwords.
const DUMMY = await hashPassword(randomToken());
export const burnPasswordCheck = (pw) => verifyPassword(pw || 'x', DUMMY).catch(() => false);

// ---------------------------------------------------------------- identity HMACs
const normId = (s) => String(s).normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normName = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
export const identityHmac = (kind, ...parts) =>
  crypto.createHmac('sha256', Buffer.from(KEYS.pepper, 'hex'))
    .update(kind + ':' + parts.map((p) => (kind === 'person' ? normName(p) : normId(p))).join('|'))
    .digest('hex');

// ---------------------------------------------------------------- rotating server key
export const currentEpoch = () => Math.floor(now() / 1000 / SECURITY.epochSeconds);
const epochKey = (e) => crypto.createHmac('sha256', Buffer.from(KEYS.master, 'hex')).update(`epoch:${e}`).digest();
export function epochInfo() {
  const e = currentEpoch();
  return {
    epoch: e,
    rotatesAt: (e + 1) * SECURITY.epochSeconds * 1000,
    periodSeconds: SECURITY.epochSeconds,
    // A public fingerprint of the current rotating key; the key itself never leaves the server.
    fingerprint: sha256(Buffer.concat([Buffer.from('fp'), epochKey(e)])).slice(0, 12),
  };
}

/** Canonical JSON: sorted keys, so the same params always hash identically. */
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
export const opHash = (op, params) => sha256(canonical({ op, params })).slice(0, 32);

/**
 * A challenge is bound to: the user, the operation, a hash of its exact parameters,
 * the current rotating-key epoch, and a single-use nonce. It is MAC'd with that
 * epoch's server key, so it expires automatically when the key rotates (≤ 2 epochs).
 */
export function issueChallenge(userId, op, params) {
  const e = currentEpoch();
  const payload = ['VCH1', userId, op, opHash(op, params), e, randomToken(12)].join('.');
  const mac = b64url(crypto.createHmac('sha256', epochKey(e)).update(payload).digest());
  return { challenge: `${payload}.${mac}`, epoch: e, expiresAt: (e + 2) * SECURITY.epochSeconds * 1000 };
}

export function checkChallenge(challenge, userId, op, params) {
  const parts = String(challenge || '').split('.');
  if (parts.length !== 7 || parts[0] !== 'VCH1') return 'Malformed challenge';
  const [, uid, cop, chash, ce, nonce, mac] = parts;
  const e = Number(ce);
  const cur = currentEpoch();
  if (!(e === cur || e === cur - 1)) return 'Challenge expired — the server key has rotated';
  const expected = crypto.createHmac('sha256', epochKey(e)).update(parts.slice(0, 6).join('.')).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return 'Challenge was not issued by this server';
  if (Number(uid) !== userId) return 'Challenge belongs to another account';
  if (cop !== op) return 'Challenge was issued for a different operation';
  if (chash !== opHash(op, params)) return 'Operation details changed after the challenge was signed';
  q.run('DELETE FROM used_nonces WHERE expires_at < ?', now());
  try {
    q.run('INSERT INTO used_nonces (nonce, expires_at) VALUES (?,?)', nonce, (e + 3) * SECURITY.epochSeconds * 1000);
  } catch { return 'Challenge already used'; }
  return null;
}

/** Verify a WebCrypto ECDSA P-256 / SHA-256 signature (raw r||s) against a stored SPKI key. */
export function verifyUserSignature(spkiB64, message, sigB64) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(spkiB64, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sigB64, 'base64'));
  } catch { return false; }
}
export function validatePublicKey(spkiB64) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(spkiB64, 'base64'), format: 'der', type: 'spki' });
    const d = key.asymmetricKeyDetails;
    return key.asymmetricKeyType === 'ec' && d?.namedCurve === 'prime256v1';
  } catch { return false; }
}
export const keyId = (spkiB64) => sha256(Buffer.from(spkiB64, 'base64')).slice(0, 16);
