// End-to-end smoke test against a throwaway database.
// Drives the real HTTP API through the full citizen lifecycle, using the same
// .access-key module the browser uses (Node provides WebCrypto).
//   npm test
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { JsonRpcProvider, Contract, Wallet } from 'ethers';
import { generateKeyPair, sealAccessFile, unlockAccessFile, signChallenge } from '../public/js/accesskey.js';

// The browser loads ethers from /vendor/ethers.js; under Node that is the ethers package.
register('data:text/javascript,' + encodeURIComponent("export async function resolve(s, c, next) { return next(s === '/vendor/ethers.js' ? 'ethers' : s, c); }"), import.meta.url);
const { aurumWallet, linkProof, signIntent } = await import('../public/js/aurum.js');
const PAYMENTS = new Set(['wallet.send', 'wallet.break', 'market.buy']);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nation-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, DATA_DIR, PORT: String(PORT), NODE_ENV: 'development', BILL_SIGNATURES: '2' };

// 1x1 PNG used as both ID photo and selfie.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const TRANSFER = [
  { name: 'from', type: 'uint32' }, { name: 'to', type: 'uint32' }, { name: 'amount', type: 'uint256' },
  { name: 'serialsHash', type: 'bytes32' }, { name: 'ref', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
];
const { AbiCoder, keccak256 } = await import('ethers');
const AbiCoderHash = (serials) => keccak256(AbiCoder.defaultAbiCoder().encode(['uint32[]'], [serials]));

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
  // Exactly what the browser's .access flow does: sign the challenge, and for payments also
  // sign the on-chain intent with the Aurum wallet derived from the same key.
  async access(op, params, url) {
    const { signingKey, pkcs8 } = await unlockAccessFile(this.accessFile, this.password, this.username);
    const ch = await this.post('/api/secure/challenge', { op, params });
    const signature = await signChallenge(signingKey, ch.data.challenge);
    const chain = PAYMENTS.has(op) ? await this.signPayment(pkcs8, op, params) : undefined;
    return this.post(url, { params, auth: { challenge: ch.data.challenge, signature, username: this.username, password: this.password, chain } });
  }
  async signPayment(pkcs8, op, params) {
    const it = (await this.post('/api/wallet/chain/intent', { op, params })).data;
    return { nonce: it.message.nonce, deadline: it.message.deadline, sig: await signIntent(aurumWallet(pkcs8), it) };
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
  const w = aurumWallet(kp.pkcs8);
  const nationName = (await c.get('/api/account/me')).data.nation.name;
  let r = await c.post('/api/account/passport/issue', { password: c.password, publicKey: kp.publicKey, chainAddress: Wallet.createRandom().address, chainProof: await linkProof(w, nationName, c.username, kp.keyId) });
  ok(r.status === 400 && /Aurum/.test(r.data.error), `${c.username}: a wallet address the key does not control is refused`);
  r = await c.post('/api/account/passport/issue', { password: c.password, publicKey: kp.publicKey, chainAddress: w.address, chainProof: await linkProof(w, nationName, c.username, kp.keyId) });
  c.wallet = w;
  c.id = (await c.get("/api/account/me")).data.user.id;
  if (r.status !== 200) console.log(r.status, r.data);
  ok(r.status === 200 && r.data.passportNo && r.data.grantValue > r.data.granted && /^0x[0-9a-f]{64}$/.test(r.data.chainTx), `${c.username}: passport ${r.data.passportNo} issued, ${r.data.granted} Sigils worth ${r.data.grantValue} SGL minted on-chain`);
  c.grantValue = r.data.grantValue;
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

    // Under 13: a parent or guardian must consent by email before a registrar can approve.
    {
      const kid = new Client('kid');
      r = await kid.post('/api/account/register', { username: 'kid', displayName: 'Kid', email: 'kid@example.com', password: 'kid-pass-12345' });
      await kid.post('/api/account/verify-email', { code: r.data.devCode });
      const kidApp = async (extra) => {
        await kid.get('/api/account/liveness');
        const f = new FormData();
        Object.entries({ legalName: 'Kid Example', dob: `${new Date().getFullYear() - 10}-01-01`, country: 'Testland', docType: 'birth_certificate', docNumber: 'BC-998877', liveCapture: '1', ...extra }).forEach(([k, v]) => f.append(k, v));
        f.append('document', new Blob([PNG], { type: 'image/png' }), 'd.png'); f.append('selfie', new Blob([PNG], { type: 'image/png' }), 's.png');
        return kid.post('/api/account/application', f);
      };
      r = await kidApp({});
      ok(r.status === 400 && /guardian/i.test(r.data.error), 'an under-13 application needs a parent or guardian');
      r = await kidApp({ guardianName: 'Pat Parent', guardianEmail: 'kid@example.com' });
      ok(r.status === 400 && /own email/.test(r.data.error), "the guardian's email cannot be the child's own");
      r = await kidApp({ guardianName: 'Pat Parent', guardianEmail: 'pat@example.com' });
      ok(r.status === 200 && r.data.guardianEmailed && r.data.devGuardianLink, 'under-13 application accepted and the guardian emailed');
      const link = new URL(r.data.devGuardianLink).pathname;
      const kidId = (await alice.get('/api/admin/applications')).data.find((a) => a.username === 'kid');
      ok(kidId.flags.some((f) => f.code === 'under_13') && kidId.flags.some((f) => f.code === 'no_photo_document'), 'reviewer sees under-13 and no-photo-document flags');
      r = await alice.post(`/api/admin/applications/${kidId.id}/decide`, { decision: 'approve' });
      ok(r.status === 400 && /consent/.test(r.data.error), 'registrar cannot approve before the guardian consents');
      const page = await fetch(`${BASE}${link}`).then((x) => x.text());
      ok(/Kid Example/.test(page) && /no cash value/.test(page) && /I consent/.test(page), 'guardian page explains what joining involves');
      ok((await fetch(`${BASE}/guardian/not-a-real-token`)).status === 404, 'a made-up consent link is refused');
      await fetch(`${BASE}${link}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'choice=consent' });
      r = await alice.post(`/api/admin/applications/${kidId.id}/decide`, { decision: 'approve' });
      ok(r.status === 200, 'after guardian consent the registrar can approve');
    }

    console.log('Ultra-secure operations');
    r = await alice.post('/api/wallet/send', { params: { to: 'bob', amount: 10 } });
    ok(r.status === 403 && r.data.need === 'access', 'transfer without .access key is refused');
    r = await alice.access('wallet.send', { to: 'bob', amount: 25, memo: 'welcome', protectRare: true }, '/api/wallet/send');
    ok(r.status === 200 && r.data.balance.available === alice.grantValue - 25, 'signed transfer of exactly 25 SGL in value');
    // Replay: reuse a signed challenge
    const { signingKey, pkcs8 } = await unlockAccessFile(alice.accessFile, alice.password, 'alice');
    const params = { to: 'bob', amount: 5, memo: '', protectRare: false };
    const ch = (await alice.post('/api/secure/challenge', { op: 'wallet.send', params })).data.challenge;
    const sig = await signChallenge(signingKey, ch);
    const auth = { challenge: ch, signature: sig, username: 'alice', password: alice.password, chain: await alice.signPayment(pkcs8, 'wallet.send', params) };
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
    Object.entries({ title: 'Hand-drawn map of Domus', description: 'A lovely ink map, A3 size.', category: 'art', price: '40', quantity: '2', condition: 'new', delivery: 'shipping' }).forEach(([k, v]) => lf.append(k, v));
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
    ok(r.data.available === bob.grantValue + 25 + 5 + 40, `bob balance is exactly grant + 70 (${r.data.available} SGL)`);

    console.log('Rarity values & Mint exchange');
    const before = (await alice.get('/api/wallet')).data;
    const toks = (await alice.get('/api/wallet/tokens?rarity=rare')).data.items;
    r = await alice.post('/api/wallet/break', { params: { serial: toks[0].serial } });
    ok(r.status === 403 && r.data.need === 'access', 'breaking a Sigil needs the .access key (it moves Sigils on-chain)');
    r = await alice.access('wallet.break', { serial: toks[0].serial }, '/api/wallet/break');
    ok(r.status === 200 && r.data.value === 5 && r.data.balance.available === before.available, 'breaking a rare (5 SGL) Sigil at the Mint keeps the balance');
    ok(r.data.balance.tokens > before.tokens, 'change Sigils received');
    r = await alice.access('wallet.break', { serial: (await alice.get('/api/wallet/tokens?rarity=common')).data.items[0].serial }, '/api/wallet/break');
    ok(r.status === 400, 'a common Sigil cannot be broken');
    // Spend all commons so exact change forces an automatic Mint exchange.
    const commons = (await alice.get('/api/wallet')).data.byRarity.common;
    r = await alice.access('wallet.send', { to: 'bob', amount: commons, memo: 'all my commons', protectRare: false }, '/api/wallet/send');
    ok(r.status === 200 && (await alice.get('/api/wallet')).data.byRarity.common === undefined, `paid ${commons} SGL using every common Sigil`);
    const bal = (await alice.get('/api/wallet')).data.available;
    r = await alice.access('wallet.send', { to: 'bob', amount: 1, memo: 'needs change', protectRare: false }, '/api/wallet/send');
    ok(r.status === 200 && r.data.balance.available === bal - 1, 'paying 1 SGL with no commons breaks a Sigil automatically and pays exactly');
    r = await bob.get('/api/gov/records/treasury');
    ok(r.data.reserveValue > 0 && r.data.circulating + r.data.reserveValue === r.data.totalValue, 'Treasury reserve accounted separately from circulation');
    ok((await alice.post(`/api/market/orders/${orderId}/review`, { rating: 5, review: 'Beautiful' })).status === 200, 'buyer leaves a review');

    console.log('On-chain Sigil (Aurum wallet)');
    {
      // A wallet signature for one payment cannot be reused for another amount.
      const { signingKey: sk, pkcs8: pk8 } = await unlockAccessFile(alice.accessFile, alice.password, 'alice');
      const p6 = { to: 'bob', amount: 6, memo: '', protectRare: false };
      const c6 = (await alice.post('/api/secure/challenge', { op: 'wallet.send', params: p6 })).data.challenge;
      r = await alice.post('/api/wallet/send', { params: p6, auth: { challenge: c6, signature: await signChallenge(sk, c6), username: 'alice', password: alice.password, chain: await alice.signPayment(pk8, 'wallet.send', { ...p6, amount: 5 }) } });
      ok(r.status === 400 && /Aurum wallet signature does not match/.test(r.data.error), 'an Aurum signature for 5 SGL cannot authorise 6 SGL');
      r = await alice.get('/api/wallet/chain');
      const w = (await alice.get('/api/wallet')).data;
      ok(r.data.address === alice.wallet.address && r.data.onChain.value === w.available + w.inEscrow, `alice's on-chain balance equals her wallet (${r.data.onChain.value} SGL)`);
      r = await bob.get('/api/gov/records/chain');
      ok(r.data.ok && r.data.sigils === r.data.checked && r.data.sigils > 2000, `every one of ${r.data.sigils} Sigils has the same owner on-chain as in the ledger`);
      // Talk to the contract directly through the public read-only RPC, as any Ethereum tool would.
      const info = (await bob.get('/api/chain')).data;
      const provider = new JsonRpcProvider(`${BASE}/api/chain/rpc`, info.chainId, { staticNetwork: true, batchMaxCount: 1 });
      const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'SigilLedger.json'), 'utf8'));
      const sigil = new Contract(info.contract, artifact.abi, provider);
      ok(!artifact.abi.some((f) => ['approve', 'transferFrom', 'setApprovalForAll', 'safeTransferFrom'].includes(f.name)), 'contract has no approve/transferFrom, so exchanges and NFT markets cannot hold Sigils');
      const { rarityFor } = await import('../server/rarity.js');
      const names = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
      let same = true;
      for (let s = 1; s <= 400; s++) if (names[Number(await sigil.rarityOf(s))] !== rarityFor(s).id) same = false;
      ok(same, 'on-chain rarity of serials 1–400 matches the ledger');
      const VAL = { common: 1, uncommon: 2, rare: 5, epic: 25, legendary: 100 };
      const two = (await alice.get('/api/wallet/tokens')).data.items.filter((t) => !t.locked_order).slice(0, 2);
      const mine = two.map((t) => t.serial);
      const amount = two.reduce((a, t) => a + VAL[t.rarity], 0);
      const nonce = Number(await sigil.nonces(alice.id));
      const msg = (to) => ({ from: alice.id, to, amount, serialsHash: AbiCoderHash(mine), ref: '0x' + '0'.repeat(64), nonce, deadline: Math.floor(Date.now() / 1000) + 600 });
      const signFor = (m) => alice.wallet.signTypedData(info.domain, { Transfer: TRANSFER }, m);
      const reason = async (m, from) => { try { await sigil.transfer.staticCall(m, await signFor(m), mine, [], { from }); return 'ok'; } catch (e) { return e.revert?.name || e.shortMessage; } };
      ok(await reason(msg(999), alice.wallet.address) === 'NotCitizen', 'a Sigil cannot be sent to anyone who is not a citizen (contract rejects it)');
      const direct = await reason(msg(bob.id), alice.wallet.address);
      ok(direct === 'ok', `the citizen could submit their own signed payment directly, without the Treasury (${direct})`);
      const forged = { ...msg(bob.id) };
      const badSig = await Wallet.createRandom().signTypedData(info.domain, { Transfer: TRANSFER }, forged);
      let why; try { await sigil.transfer.staticCall(forged, badSig, mine, [], { from: info.registrar }); } catch (e) { why = e.revert?.name; }
      ok(why === 'BadSignature', 'even the Treasury cannot move a citizen\'s Sigils without their signature');
    }

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

    console.log('National Council & Applications Office');
    {
      let pos = (await bob.get('/api/offices/positions')).data.items;
      const hosPos = pos.find((p) => p.level === 'head_of_state');
      const seat = pos.find((p) => p.key === 'council-member');
      ok(hosPos.holders[0]?.username === 'alice' && seat.seats === 6 && pos.some((p) => p.level === 'staff'), `${pos.length} public offices listed; alice holds Head of State`);
      await passportCheck(bob);
      r = await bob.post(`/api/offices/positions/${hosPos.id}/apply`, { statement: 'I would like to lead the nation with care and openness.' });
      ok(r.status === 400 && /Head of State/.test(r.data.error), 'no applications for Head of State while the office is held');
      r = await bob.post(`/api/offices/positions/${seat.id}/apply`, { statement: 'I will scrutinise the government and represent new citizens.' });
      ok(r.status === 200, 'bob applies for a Council seat');
      const appId = r.data.id;
      r = await bob.access('office.decide', { applicationId: appId, decision: 'accept', note: '' }, '/api/offices/decide');
      ok(r.status === 403, 'nobody decides their own application');
      r = await alice.access('office.decide', { applicationId: appId, decision: 'accept', note: '' }, '/api/offices/decide');
      ok(r.status === 200, 'Head of State appoints bob to the Council (signed)');
      r = await bob.get('/api/offices/council');
      ok(r.data.members.some((m) => m.username === 'bob') && (await bob.get('/api/account/me')).data.user.role === 'official', 'bob sits on the National Council');
      r = await alice.post('/api/offices/resign', {});
      ok(r.status === 200 && (await alice.get('/api/account/me')).data.user.role === 'member', 'Head of State resigns; the office is vacant');
      r = await alice.post(`/api/offices/positions/${hosPos.id}/apply`, { statement: 'I served as founder and ask the Council to choose me again.' });
      ok(r.status === 200, 'alice stands for Head of State');
      const cand = r.data.id;
      r = await alice.access('office.vote', { applicationId: cand, vote: 'yes' }, '/api/offices/vote');
      ok(r.status === 403, 'only Council members vote, and never on themselves');
      r = await bob.access('office.vote', { applicationId: cand, vote: 'yes' }, '/api/offices/vote');
      ok(r.status === 200 && r.data.result === 'elected', 'the Council elects a Head of State by majority');
      ok((await alice.get('/api/account/me')).data.user.role === 'admin', 'alice is Head of State again');
    }

    console.log('Statute book');
    r = await bob.get('/api/gov/laws');
    ok(r.data.total >= 69 && r.data.kinds.act >= 50 && r.data.areas.length >= 12, `${r.data.total} laws across ${r.data.areas.length} areas`);
    r = await bob.get('/api/gov/laws?area=Criminal%20Law');
    ok(r.data.items.length >= 4 && r.data.items.every((l) => l.area === 'Criminal Law'), 'laws filter by area');
    r = await bob.get('/api/gov/laws?q=Mint%20change');
    ok(r.data.items.some((l) => l.title === 'Mint Exchange Act'), 'full-text law search');

    console.log('Forum, records & ledger');
    const cats = (await bob.get('/api/forum/categories')).data;
    r = await bob.post('/api/forum/threads', { categoryId: cats.find((c) => c.slug === 'general').id, title: 'Hello from a new citizen', body: 'Glad to be here!' });
    ok(r.status === 200, 'forum thread created');
    ok((await alice.post(`/api/forum/threads/${r.data.id}/posts`, { body: 'Welcome, Bob!' })).status === 200, 'reply posted');
    r = await bob.get(`/api/gov/verify/${bob.passportNo}?token=${encodeURIComponent(bob.passportSvg.match(/<metadata[^>]*>([^<]+)</)[1])}`);
    ok(r.data.valid && r.data.tokenCheck === 'authentic', 'public passport verification');
    r = await bob.get('/api/gov/records/ledger/verify');
    ok(r.data.ok && r.data.entries >= 10, `ledger chain verifies (${r.data.entries} entries, all signatures valid)`);
    r = await bob.get('/api/gov/records/registry');
    ok(r.data.total === 2 && !JSON.stringify(r.data).includes('@example.com'), 'registry lists citizens without private data');

    console.log(`\nAll ${passed} checks passed.`);
  } finally {
    await new Promise((res) => { server.once('exit', res); server.kill(); });
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* Windows may hold the WAL briefly */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
