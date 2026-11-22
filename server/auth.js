import { q, now } from './db.js';
import { SECURITY } from './config.js';
import { sha256, randomToken, checkChallenge, verifyUserSignature, verifyPassword } from './security.js';
import { HttpError, forbidden, rateLimit } from './util.js';

const COOKIE = 'nsid';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(req, res, userId) {
  const token = randomToken(32);
  const expires = now() + SECURITY.sessionDays * 864e5;
  q.run('INSERT INTO sessions (id, user_id, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?)',
    sha256(token), userId, now(), expires, req.ip, String(req.headers['user-agent'] || '').slice(0, 200));
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SECURITY.sessionDays * 86400}${req.secure ? '; Secure' : ''}`);
}

export function destroySession(req, res) {
  if (req.sessionId) q.run('DELETE FROM sessions WHERE id = ?', req.sessionId);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

export function loadSession(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const id = sha256(token);
    const s = q.get('SELECT * FROM sessions WHERE id = ? AND expires_at > ?', id, now());
    if (s) {
      const u = q.get('SELECT * FROM users WHERE id = ?', s.user_id);
      if (u) { req.user = u; req.sessionId = id; req.sess = s; }
    }
  }
  next();
}

/** Mutating API calls must carry a custom header — browsers won't send it cross-site without a CORS preflight we never approve. */
export function csrf(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.headers['x-nation-request'] === '1') return next();
  next(forbidden('Missing request header'));
}

export const isCitizen = (u) => u && u.status === 'citizen';
export const isOfficial = (u) => u && (u.role === 'official' || u.role === 'admin') && u.status !== 'suspended';
export const isAdmin = (u) => u && u.role === 'admin' && u.status !== 'suspended';

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  if (['suspended', 'banned'].includes(req.user.status)) return next(forbidden('This account is suspended'));
  next();
}
export function requireCitizen(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!isCitizen(req.user)) return next(forbidden('Only verified citizens can do this. Complete your citizenship application first.', { need: 'citizenship' }));
    next();
  });
}
export const requireOfficial = (req, res, next) => requireAuth(req, res, (err) => next(err || (isOfficial(req.user) ? undefined : forbidden('Government officials only'))));
export const requireAdmin = (req, res, next) => requireAuth(req, res, (err) => next(err || (isAdmin(req.user) ? undefined : forbidden('Head of State (administrator) only'))));

/** Standard-security gate: the session must have passed a passport-image check recently. */
export function requirePassport(req, res, next) {
  requireCitizen(req, res, (err) => {
    if (err) return next(err);
    if ((req.sess?.passport_until || 0) > now()) return next();
    next(forbidden('Identity check required: upload your passport image to continue.', { need: 'passport' }));
  });
}

/**
 * Ultra-secure gate. The request body must contain `auth`:
 *   { challenge, signature, username, password }
 * where `challenge` was issued by POST /api/secure/challenge for exactly this op + params,
 * and `signature` is made with the private key decrypted from the citizen's .access file.
 */
export function requireAccess(op, paramsOf) {
  return async (req, res, next) => {
    try {
      await new Promise((ok, fail) => requireCitizen(req, res, (e) => (e ? fail(e) : ok())));
      const auth = req.body?.auth;
      if (!auth?.challenge || !auth?.signature) throw forbidden('This action requires your .access key.', { need: 'access', op });
      rateLimit(`access:${req.user.id}`, 12, 10 * 60e3);
      const params = paramsOf(req) || {};
      const problem = checkChallenge(auth.challenge, req.user.id, op, params);
      if (problem) throw forbidden(problem, { need: 'access', op });
      if (!req.user.public_key || !verifyUserSignature(req.user.public_key, auth.challenge, auth.signature)) {
        throw forbidden('The .access key signature is not valid for this account.', { need: 'access', op });
      }
      if (String(auth.username || '').toLowerCase() !== req.user.username.toLowerCase() || !(await verifyPassword(auth.password || '', req.user.pw_hash))) {
        throw forbidden('Account name or password is incorrect.', { need: 'access', op });
      }
      req.access = { op, params, challenge: auth.challenge, signature: auth.signature, chain: auth.chain || null };
      next();
    } catch (e) { next(e); }
  };
}

/** Public-safe projection of a user for API responses. */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, displayName: u.display_name, role: u.role, status: u.status,
    officialTitle: u.official_title, departmentId: u.department_id, bio: u.bio,
    passportNo: u.status === 'citizen' ? u.passport_no : null, citizenSince: u.citizen_since,
  };
}
