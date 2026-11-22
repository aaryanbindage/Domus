// Digital passport: an SVG data page with a server-signed token embedded in it.
// The token is what the "passport image check" verifies — it survives SVG download
// and the client-side PNG export (which writes it into a PNG tEXt chunk).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { NATION, PUBLIC_URL, PRIVATE_DIR } from './config.js';
import { q } from './db.js';
import { b64url, serverSign, serverVerify } from './security.js';

export const TOKEN_KEY = 'nation-passport';

export function newPassportNumber() {
  for (;;) {
    const pn = NATION.code.slice(0, 2) + String(crypto.randomInt(0, 1e7)).padStart(7, '0');
    if (!q.get('SELECT 1 FROM users WHERE passport_no = ?', pn)) return pn;
  }
}

export function passportToken(user) {
  const payload = b64url(JSON.stringify({ pn: user.passport_no, uid: user.id, v: user.passport_version, iat: user.passport_issued_at }));
  return `${payload}.${serverSign(`passport:${payload}`)}`;
}

/** Returns the decoded payload if the token is authentic, else null. */
export function readPassportToken(token) {
  const [payload, sig] = String(token || '').trim().split('.');
  if (!payload || !sig || !serverVerify(`passport:${payload}`, sig)) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
}

/** Pull the embedded token out of an uploaded passport image (SVG or PNG). */
export function extractToken(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    let off = 8;
    while (off + 12 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      if (type === 'tEXt') {
        const data = buf.subarray(off + 8, off + 8 + len);
        const nul = data.indexOf(0);
        if (data.toString('latin1', 0, nul) === TOKEN_KEY) return data.toString('latin1', nul + 1);
      }
      if (type === 'IEND') break;
      off += 12 + len;
    }
    return null;
  }
  const text = buf.toString('utf8');
  const m = text.match(new RegExp(`<metadata[^>]*id="${TOKEN_KEY}"[^>]*>([A-Za-z0-9_.-]+)</metadata>`));
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- MRZ (ICAO 9303 TD3)
const mrzVal = (c) => (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55);
const check = (s) => String([...s].reduce((sum, c, i) => sum + mrzVal(c) * [7, 3, 1][i % 3], 0) % 10);
const mrzText = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '<');
const yymmdd = (d) => { const x = new Date(d); return `${String(x.getUTCFullYear()).slice(2)}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`; };

function splitName(legal) {
  const parts = String(legal || '').trim().split(/\s+/);
  const surname = parts.length > 1 ? parts.pop() : parts[0] || '';
  return { surname, given: parts.join(' ') };
}

export function mrz(user, expiry) {
  const { surname, given } = splitName(user.legal_name);
  const l1 = (`P<${NATION.code}${mrzText(surname)}<<${mrzText(given)}`).padEnd(44, '<').slice(0, 44);
  const pn = user.passport_no.padEnd(9, '<');
  const dob = yymmdd(user.dob);
  const exp = yymmdd(expiry);
  const personal = String(user.id).padStart(14, '0');
  const body = pn + check(pn) + NATION.code + dob + check(dob) + '<' + exp + check(exp) + personal + check(personal);
  const composite = check(pn + check(pn) + dob + check(dob) + exp + check(exp) + personal + check(personal));
  return [l1, body + composite];
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();

export async function passportSvg(user) {
  const issued = user.passport_issued_at;
  const expiry = new Date(issued); expiry.setUTCFullYear(expiry.getUTCFullYear() + 10);
  const { surname, given } = splitName(user.legal_name);
  const [m1, m2] = mrz(user, expiry);
  const token = passportToken(user);
  let photo = '';
  if (user.photo_path) {
    const p = path.join(PRIVATE_DIR, user.photo_path);
    if (fs.existsSync(p)) photo = `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
  }
  const qr = (await QRCode.toString(`${PUBLIC_URL}/#/verify/${user.passport_no}`, { type: 'svg', margin: 0, color: { dark: '#0b2545', light: '#0000' } }))
    .replace(/<\?xml[^>]*>/, '').replace('<svg', '<svg x="836" y="430" width="120" height="120"');
  const field = (x, y, label, value, size = 22) => `
    <text x="${x}" y="${y}" class="lbl">${esc(label)}</text>
    <text x="${x}" y="${y + size + 6}" class="val" font-size="${size}">${esc(value)}</text>`;
  const guilloche = Array.from({ length: 18 }, (_, i) =>
    `<ellipse cx="640" cy="330" rx="${120 + i * 22}" ry="${60 + i * 13}" fill="none" stroke="#1d4e89" stroke-opacity="0.07" stroke-width="1.2" transform="rotate(${i * 10} 640 330)"/>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="660" viewBox="0 0 1000 660" font-family="'Courier New', monospace">
<metadata id="${TOKEN_KEY}">${token}</metadata>
<title>${esc(NATION.name)} — Passport ${esc(user.passport_no)}</title>
<defs>
  <linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6f1e3"/><stop offset="1" stop-color="#e9e1cc"/></linearGradient>
  <linearGradient id="hd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0b2545"/><stop offset="1" stop-color="#1d4e89"/></linearGradient>
  <clipPath id="ph"><rect x="48" y="150" width="230" height="290" rx="10"/></clipPath>
  <style>.lbl{font-family:Arial,Helvetica,sans-serif;font-size:12px;fill:#5b6b7f;letter-spacing:1px;text-transform:uppercase}.val{font-family:Arial,Helvetica,sans-serif;font-weight:700;fill:#0b2545}</style>
</defs>
<rect width="1000" height="660" rx="28" fill="url(#pg)"/>
${guilloche}
<rect width="1000" height="110" rx="28" fill="url(#hd)"/><rect y="80" width="1000" height="30" fill="url(#hd)"/>
<g transform="translate(64 55)">
  <circle r="36" fill="none" stroke="#c9a227" stroke-width="3"/><circle r="28" fill="none" stroke="#c9a227" stroke-width="1"/>
  <path d="M0-20 L6-6 L21-6 L9 3 L13 18 L0 9 L-13 18 L-9 3 L-21-6 L-6-6Z" fill="#c9a227"/>
</g>
<text x="120" y="50" font-family="Georgia,serif" font-size="30" fill="#fff" letter-spacing="2">${esc(NATION.name.toUpperCase())}</text>
<text x="120" y="82" font-family="Arial,sans-serif" font-size="15" fill="#c9d6ea" letter-spacing="4">PASSPORT · PASSEPORT · PASAPORTE</text>
<text x="950" y="64" text-anchor="end" font-family="Arial,sans-serif" font-size="13" fill="#c9a227" letter-spacing="2">DIGITAL CITIZEN</text>
${photo ? `<image href="${photo}" x="48" y="150" width="230" height="290" preserveAspectRatio="xMidYMid slice" clip-path="url(#ph)"/>` : `<rect x="48" y="150" width="230" height="290" rx="10" fill="#d8d0bb"/>`}
<rect x="48" y="150" width="230" height="290" rx="10" fill="none" stroke="#0b2545" stroke-opacity=".25"/>
${field(318, 160, 'Type / Code', `P  ·  ${NATION.code}`)}
${field(560, 160, 'Passport No.', user.passport_no)}
${field(318, 225, 'Surname', surname.toUpperCase())}
${field(318, 290, 'Given names', (given || '—').toUpperCase())}
${field(318, 355, 'Nationality', NATION.demonym.toUpperCase(), 20)}
${field(560, 355, 'Date of birth', fmt(user.dob), 20)}
${field(318, 420, 'Date of issue', fmt(issued), 20)}
${field(560, 420, 'Date of expiry', fmt(expiry), 20)}
${field(318, 485, 'Authority', 'DEPT. OF CITIZENSHIP', 18)}
${field(560, 485, 'Account', '@' + user.username, 18)}
${field(48, 485, 'Holder signature key', user.key_id || '—', 15)}
<text x="896" y="572" text-anchor="middle" class="lbl">Scan to verify</text>
${qr}
<rect x="0" y="580" width="1000" height="80" fill="#fff" fill-opacity=".55"/>
<text x="40" y="612" font-size="25" fill="#111" letter-spacing="3.2">${esc(m1)}</text>
<text x="40" y="644" font-size="25" fill="#111" letter-spacing="3.2">${esc(m2)}</text>
</svg>`;
}
