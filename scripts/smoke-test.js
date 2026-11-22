// End-to-end smoke test against a throwaway database.
// Drives the real HTTP API through the full citizen lifecycle, using the same
// .access-key module the browser uses (Node provides WebCrypto).
//   npm test
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, sealAccessFile, unlockAccessFile, signChallenge } from '../public/js/accesskey.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nation-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, DATA_DIR, PORT: String(PORT), NODE_ENV: 'development', BILL_SIGNATURES: '2' };

// 1x1 PNG used as both ID photo and selfie.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let passed = 0;
const ok = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); passed++; console.log(`  ✓ ${msg}`); };

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(method, url, body) {
    const headers = { 'X-Nation-Request': '1', cookie: this.cookie };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  async access(op, params, url) {
    const { signingKey } = await unlockAccessFile(this.accessFile, this.password, this.username);
    const ch = await this.post('/api/secure/challenge', { op, params });
    const signature = await signChallenge(signingKey, ch.data.challenge);
    return this.post(url, { params, auth: { challenge: ch.data.challenge, signature, username: this.username, password: this.password } });
  }
}

async function becomeApplicant(c, username, docNumber) {
  c.username = username; c.password = 'correct-horse-42';
  let r = await c.post('/api/account/register', { username, displayName: username.toUpperCase(), email: `${username}@example.com`, password: c.password });
  ok(r.status === 200 && r.data.devCode, `${username}: registered`);
  r = await c.post('/api/account/verify-email', { code: r.data.devCode });
  ok(r.status === 200, `${username}: email verified`);
  await c.get('/api/account/liveness');
  const fd = new FormData();
  Object.entries({ legalName: `${username} Example`, dob: '1995-04-12', country: 'Testland', docType: 'passport', docNumber, liveCapture: '1', dhash: '0f0f0f0f0f0f0f0f' }).forEach(([k, v]) => fd.append(k, v));
  fd.append('document', new Blob([PNG], { type: 'image/png' }), 'doc.png');
  fd.append('selfie', new Blob([PNG], { type: 'image/png' }), 'selfie.png');
  r = await c.post('/api/account/application', fd);
  ok(r.status === 200, `${username}: application submitted`);
}

async function issuePassport(c) {
  const kp = await generateKeyPair();
  const r = await c.post('/api/account/passport/issue', { password: c.password, publicKey: kp.publicKey });
  ok(r.status === 200 && r.data.passportNo, `${c.username}: passport ${r.data.passportNo} issued, ${r.data.granted} Sigils granted`);
  c.passportNo = r.data.passportNo;
  c.accessFile = await sealAccessFile({ ...kp, account: c.username, passportNo: r.data.passportNo, nation: 'Test', password: c.password });
  const svg = await fetch(`${BASE}/api/account/passport.svg`, { headers: { cookie: c.cookie } }).then((x) => x.text());
  c.passportSvg = svg;
}

async function passportCheck(c, svg = c.passportSvg) {
  const fd = new FormData();
  fd.append('passport', new Blob([svg], { type: 'image/svg+xml' }), 'passport.svg');
  return c.post('/api/account/passport/check', fd);
}

async function main() {
  const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('online')) res(); }));
  try {
    const alice = new Client('alice'); const bob = new Client('bob'); const mallory = new Client('mallory');
    console.log('Citizenship');
    await becomeApplicant(alice, 'alice', 'A1234567');
    const adm = spawnSync(process.execPath, ['--no-warnings=ExperimentalWarning', 'scripts/make-admin.js', 'alice', '--approve'], { cwd: ROOT, env, encoding: 'utf8' });
    ok(adm.status === 0, 'make-admin --approve founder');
    await issuePassport(alice);
    await becomeApplicant(bob, 'bob', 'B7654321');

    let r = await mallory.post('/api/account/register', { username: 'mallory', displayName: 'Mal', email: 'mallory@example.com', password: 'another-pass-9' });
    await mallory.post('/api/account/verify-email', { code: r.data.devCode });
    await mallory.get('/api/account/liveness');
    const fd = new FormData();
    Object.entries({ legalName: 'Bob Example', dob: '1995-04-12', country: 'testland', docType: 'passport', docNumber: 'b7654-321', liveCapture: '1' }).forEach(([k, v]) => fd.append(k, v));
    fd.append('document', new Blob([PNG]), 'd.png'); fd.append('selfie', new Blob([PNG]), 's.png');
    r = await mallory.post('/api/account/application', fd);
    ok(r.status === 400 && /already registered/.test(r.data.error), 'duplicate identity document (normalised) is refused');

    r = await alice.get('/api/admin/applications');
    const bobApp = r.data.find((a) => a.username === 'bob');
    r = await alice.post(`/api/admin/applications/${bobApp.id}/decide`, { decision: 'approve' });
    ok(r.status === 403 && r.data.need === 'passport', 'reviewing requires a passport check');
    r = await passportCheck(alice, alice.passportSvg.replace(/(<metadata[^>]*>)(.)/, (_, a, ch) => a + (ch === 'A' ? 'B' : 'A')));
    ok(r.status === 403, 'tampered passport image is rejected');
    r = await passportCheck(alice);
    ok(r.status === 200, 'genuine passport SVG passes the check');
    r = await alice.post(`/api/admin/applications/${bobApp.id}/decide`, { decision: 'approve' });
    ok(r.status === 200, 'registrar approves bob');
    await issuePassport(bob);
    r = await passportCheck(bob, alice.passportSvg);
    ok(r.status === 403 && /different citizen/.test(r.data.error), "someone else's passport is rejected");

    console.log('Ultra-secure operations');
    r = await alice.post('/api/wallet/send', { params: { to: 'bob', amount: 10 } });
    ok(r.status === 403 && r.data.need === 'access', 'transfer without .access key is refused');
    r = await alice.access('wallet.send', { to: 'bob', amount: 25, memo: 'welcome', protectRare: true }, '/api/wallet/send');
    ok(r.status === 200 && r.data.balance.available === 975, 'signed transfer of 25 Sigils');
    // Replay: reuse a signed challenge
    const { signingKey } = await unlockAccessFile(alice.accessFile, alice.password, 'alice');
    const params = { to: 'bob', amount: 5, memo: '', protectRare: false };
    const ch = (await alice.post('/api/secure/challenge', { op: 'wallet.send', params })).data.challenge;
    const sig = await signChallenge(signingKey, ch);
    const auth = { challenge: ch, signature: sig, username: 'alice', password: alice.password };
    r = await alice.post('/api/wallet/send', { params: { ...params, amount: 500 }, auth });
    ok(r.status === 403 && /changed/.test(r.data.error), 'challenge bound to parameters (amount tampering refused)');
    r = await alice.post('/api/wallet/send', { params, auth });
    ok(r.status === 200, 'challenge accepted once');
    r = await alice.post('/api/wallet/send', { params, auth });
    ok(r.status === 403 && /already used/.test(r.data.error), 'replayed challenge refused');
    r = await alice.post('/api/wallet/send', { params: { ...params, amount: 1 }, auth: { ...(await (async () => { const c2 = (await alice.post('/api/secure/challenge', { op: 'wallet.send', params: { ...params, amount: 1 } })).data.challenge; return { challenge: c2, signature: await signChallenge(signingKey, c2) }; })()), username: 'alice', password: 'wrong-password-1' } });
    ok(r.status === 403 && /password/.test(r.data.error), 'wrong password refused even with valid signature');
    let bad = false; try { await unlockAccessFile(alice.accessFile, 'not-the-password', 'alice'); } catch { bad = true; }
    ok(bad, '.access file does not decrypt with the wrong password');

    console.log('Marketplace');
    await passportCheck(bob);
    const lf = new FormData();
    Object.entries({ title: 'Hand-drawn map of Veridia', description: 'A lovely ink map, A3 size.', category: 'art', price: '40', quantity: '2', condition: 'new', delivery: 'shipping' }).forEach(([k, v]) => lf.append(k, v));
    lf.append('images', new Blob([PNG]), 'map.png');
    r = await bob.post('/api/market/listings', lf);
    ok(r.status === 200, 'bob lists an item');
    const listingId = r.data.id;
    r = await alice.access('market.buy', { listingId, quantity: 1, unitPrice: 30 }, `/api/market/listings/${listingId}/buy`);
    ok(r.status === 400 && /price changed/.test(r.data.error), 'stale price in signed purchase is refused');
    r = await alice.access('market.buy', { listingId, quantity: 1, unitPrice: 40 }, `/api/market/listings/${listingId}/buy`);
    ok(r.status === 200, 'alice buys into escrow');
    const orderId = r.data.orderId;
    r = await alice.get('/api/wallet');
    ok(r.data.inEscrow === 40, '40 Sigils held in escrow');
    ok((await bob.post(`/api/market/orders/${orderId}/ship`, { note: 'Posted, tracking VR123' })).status === 200, 'seller marks delivered');
    ok((await alice.post(`/api/market/orders/${orderId}/confirm`)).status === 200, 'buyer confirms, escrow released');
    r = await bob.get('/api/wallet');
    ok(r.data.available === 1000 + 25 + 5 + 40, `bob balance is ${r.data.available}`);
    ok((await alice.post(`/api/market/orders/${orderId}/review`, { rating: 5, review: 'Beautiful' })).status === 200, 'buyer leaves a review');

    console.log('Legislature');
    r = await alice.post('/api/gov/bills', { title: 'Sigil Savings Week Act', summary: 'Declares a national savings week every spring.', body: '## 1. Savings week\nThe first week of spring is National Savings Week, celebrated by every citizen.' });
    ok(r.status === 200, 'bill tabled');
    const billId = r.data.id;
    ok((await bob.post(`/api/gov/bills/${billId}/sign`)).status === 200, 'second sponsor signs → vote opens');
    r = await bob.get(`/api/gov/bills/${billId}`);
    ok(r.data.status === 'voting', 'bill is in national vote');
    ok((await alice.access('bill.vote', { billId, choice: 'yes' }, `/api/gov/bills/${billId}/vote`)).status === 200, 'alice votes yes (signed)');
    ok((await bob.access('bill.vote', { billId, choice: 'yes' }, `/api/gov/bills/${billId}/vote`)).status === 200, 'bob votes yes (signed)');
    r = await bob.access('bill.vote', { billId, choice: 'no' }, `/api/gov/bills/${billId}/vote`);
    ok(r.status === 400, 'double voting refused');

    console.log('Forum, records & ledger');
    const cats = (await bob.get('/api/forum/categories')).data;
    r = await bob.post('/api/forum/threads', { categoryId: cats.find((c) => c.slug === 'general').id, title: 'Hello from a new citizen', body: 'Glad to be here!' });
    ok(r.status === 200, 'forum thread created');
    ok((await alice.post(`/api/forum/threads/${r.data.id}/posts`, { body: 'Welcome, Bob!' })).status === 200, 'reply posted');
    r = await bob.get(`/api/gov/verify/${bob.passportNo}?token=${encodeURIComponent(bob.passportSvg.match(/<metadata[^>]*>([^<]+)</)[1])}`);
    ok(r.data.valid && r.data.tokenCheck === 'authentic', 'public passport verification');
    r = await bob.get('/api/gov/records/ledger/verify');
    ok(r.data.ok && r.data.entries >= 6, `ledger chain verifies (${r.data.entries} entries, all signatures valid)`);
    r = await bob.get('/api/gov/records/registry');
    ok(r.data.total === 2 && !JSON.stringify(r.data).includes('@example.com'), 'registry lists citizens without private data');

    console.log(`\nAll ${passed} checks passed.`);
  } finally {
    await new Promise((res) => { server.once('exit', res); server.kill(); });
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* Windows may hold the WAL briefly */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
