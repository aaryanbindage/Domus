// The .access key file — all cryptography happens here, in the citizen's browser.
//
//   generate  → ECDSA P-256 key pair. Private key (PKCS#8) is wrapped as text
//               "NATION-ACCESS-KEY/1 <base64>" and encrypted with AES-256-GCM under a key
//               derived from the account password (PBKDF2-SHA256, 600k iterations).
//               Only the public key is ever sent to the server.
//   unlock    → decrypt the file with the password; the decrypted text becomes a
//               non-extractable signing key.
//   sign      → sign a server challenge (bound to the rotating server key + the action).

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const ITERATIONS = 600000;
const BEGIN = '-----BEGIN NATION ACCESS KEY-----';
const END = '-----END NATION ACCESS KEY-----';

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const keyIdOf = async (spkiB64) => hex(await crypto.subtle.digest('SHA-256', unb64(spkiB64))).slice(0, 16);

export async function generateKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const spki = b64(await crypto.subtle.exportKey('spki', kp.publicKey));
  return { pkcs8: b64(pkcs8), publicKey: spki, keyId: await keyIdOf(spki) };
}

/** Build the .access file text. `account` is bound into the ciphertext as AES-GCM associated data. */
export async function sealAccessFile({ pkcs8, publicKey, keyId, account, passportNo, nation, password }) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const plaintext = `NATION-ACCESS-KEY/1 ${pkcs8}`;
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(account.toLowerCase()) }, key, enc.encode(plaintext));
  const body = b64(ct).match(/.{1,64}/g).join('\n');
  return [
    BEGIN,
    `Nation: ${nation}`,
    `Account: ${account}`,
    `Passport: ${passportNo}`,
    `Key-Id: ${keyId}`,
    `Public-Key: ${publicKey}`,
    `Issued: ${new Date().toISOString()}`,
    `Cipher: AES-256-GCM`,
    `KDF: PBKDF2-SHA256/${ITERATIONS}`,
    `Salt: ${b64(salt)}`,
    `IV: ${b64(iv)}`,
    '',
    body,
    END,
    '',
  ].join('\n');
}

export function parseAccessFile(text) {
  const t = String(text).replace(/\r/g, '');
  const start = t.indexOf(BEGIN); const end = t.indexOf(END);
  if (start < 0 || end < 0) throw new Error('This is not a .access key file');
  const inner = t.slice(start + BEGIN.length, end).trim();
  const [head, ...rest] = inner.split('\n\n');
  const headers = Object.fromEntries(head.split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const iterations = Number((headers.KDF || '').split('/')[1]);
  if (!headers.Salt || !headers.IV || !iterations) throw new Error('The .access file is damaged (missing headers)');
  return { headers, iterations, salt: unb64(headers.Salt), iv: unb64(headers.IV), ciphertext: unb64(rest.join('')) };
}

/** Decrypt the file. Returns { signingKey (non-extractable), headers, pkcs8 }. */
export async function unlockAccessFile(text, password, account) {
  const f = parseAccessFile(text);
  const key = await deriveKey(password, f.salt, f.iterations);
  let plain;
  try {
    plain = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: f.iv, additionalData: enc.encode((account || f.headers.Account || '').toLowerCase()) }, key, f.ciphertext));
  } catch { throw new Error('Could not decrypt the .access file — wrong password, wrong account, or the file was altered'); }
  const m = plain.match(/^NATION-ACCESS-KEY\/1 ([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('Decrypted content is not a valid key');
  const signingKey = await crypto.subtle.importKey('pkcs8', unb64(m[1]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { signingKey, headers: f.headers, pkcs8: m[1] };
}

export async function signChallenge(signingKey, challenge) {
  return b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, enc.encode(challenge)));
}

export function downloadText(filename, text, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- passport PNG export
// Renders the passport SVG to PNG and writes the signed token into a tEXt chunk, so the
// PNG passes the same passport check as the SVG.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export async function passportSvgToPng(svgText, tokenKey = 'nation-passport') {
  const token = svgText.match(new RegExp(`<metadata[^>]*id="${tokenKey}"[^>]*>([^<]+)</metadata>`))?.[1];
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('Could not render passport')); img.src = url; });
  const canvas = Object.assign(document.createElement('canvas'), { width: 2000, height: 1320 });
  canvas.getContext('2d').drawImage(img, 0, 0, 2000, 1320);
  URL.revokeObjectURL(url);
  const png = new Uint8Array(await (await new Promise((ok) => canvas.toBlob(ok, 'image/png'))).arrayBuffer());
  if (!token) return png;
  const data = enc.encode(`${tokenKey}\0${token}`);
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(enc.encode('tEXt'), 4);
  chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  // Insert right after IHDR (8-byte signature + 25-byte IHDR chunk).
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, 33)); out.set(chunk, 33); out.set(png.subarray(33), 33 + chunk.length);
  return out;
}
