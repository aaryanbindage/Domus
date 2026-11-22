import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg, extra) => new HttpError(403, msg, extra);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function str(v, name, { min = 1, max = 500, pattern, optional = false } = {}) {
  if (v == null || v === '') { if (optional) return ''; throw bad(`${name} is required`); }
  const s = String(v).trim();
  if (s.length < min) throw bad(`${name} must be at least ${min} characters`);
  if (s.length > max) throw bad(`${name} must be at most ${max} characters`);
  if (pattern && !pattern.test(s)) throw bad(`${name} is not valid`);
  return s;
}
export function int(v, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}`);
  return n;
}
export const oneOf = (v, name, options) => { if (!options.includes(v)) throw bad(`${name} must be one of: ${options.join(', ')}`); return v; };

export function page(req, size = 20) {
  const p = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  return { page: p, limit: size, offset: (p - 1) * size };
}

// ---------------------------------------------------------------- rate limiting (in-memory, per key)
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < t) { buckets.set(key, { n: 1, reset: t + windowMs }); return; }
  if (++b.n > max) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil((b.reset - t) / 1000)}s.`);
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60e3).unref();

// ---------------------------------------------------------------- uploads
const IMAGE_SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.toString('latin1', 0, 4) === 'GIF8' },
];
/** Identify an image by its magic bytes, never by the client-supplied name or MIME type. */
export const sniffImage = (buf) => IMAGE_SIGNATURES.find((s) => buf.length > 12 && s.test(buf)) || null;

export const memoryUpload = (maxMb = 8, maxFiles = 6) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: maxFiles, fields: 30 } });

/** Persist an uploaded image buffer under dir with a random name; returns the stored filename. */
export function saveImage(buf, dir) {
  const kind = sniffImage(buf);
  if (!kind) throw bad('Uploaded file is not a supported image (JPEG, PNG, WebP or GIF)');
  const name = `${crypto.randomBytes(16).toString('hex')}.${kind.ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return name;
}
