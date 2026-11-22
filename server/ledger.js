// The Sigil ledger. Every Sigil is a numbered collectible whose rarity is derived from
// its serial, and each rarity has a fixed face value in SGL. Ownership lives on-chain in
// the SigilLedger contract (see chain.js): every grant, payment, Mint exchange and escrow
// movement is a transaction there, and citizen payments are signed with the citizen's own
// Sigil wallet key. This database mirrors the chain for fast queries and keeps a
// hash-chained, server-signed journal of every movement with its transaction hash.
import { q, tx, now } from './db.js';
import { canonical, sha256, serverSign, serverVerify, verifyUserSignature, opHash } from './security.js';
import { NATION } from './config.js';
import { RARITIES, RANK, rarityFor, valueOf } from './rarity.js';
import * as chain from './chain.js';

export { RARITIES, rarityFor, valueOf };
/** Owner id of the Treasury reserve (tokens out of circulation). */
export const TREASURY = 0;
const VALUES = NATION.currency.values;
const SYM = NATION.currency.symbol;
/** SQL expression giving the SGL value of a tokens row. */
const VALUE_SQL = `CASE rarity ${RARITIES.map((r) => `WHEN '${r.id}' THEN ${r.value}`).join(' ')} END`;

const fail = (msg) => Object.assign(new Error(msg), { status: 400 });

// Store serial lists compactly as ranges: "1-5,9,12-20"
export function compress(serials) {
  const s = [...serials].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`);
    i = j + 1;
  }
  return out.join(',');
}
export function expand(str) {
  if (!str) return [];
  return str.split(',').flatMap((p) => {
    const [a, b] = p.split('-').map(Number);
    return b ? Array.from({ length: b - a + 1 }, (_, k) => a + k) : [a];
  });
}

function append(entry) {
  const prev = q.get('SELECT hash FROM ledger ORDER BY id DESC LIMIT 1')?.hash || '0'.repeat(64);
  const ts = now();
  const body = {
    ts, type: entry.type, from: entry.from ?? null, to: entry.to ?? null, amount: entry.amount,
    serials: entry.serials, memo: entry.memo || '', ref: entry.ref ?? null,
    params: entry.params ?? null, challenge: entry.challenge ?? null, sig: entry.sig ?? null, chainTx: entry.chainTx ?? undefined,
  };
  const hash = sha256(prev + canonical(body));
  const r = q.run(`INSERT INTO ledger (ts,type,from_id,to_id,amount,serials,memo,ref,op_params,challenge,sender_sig,prev_hash,hash,server_sig,chain_tx)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ts, body.type, body.from, body.to, body.amount, body.serials, body.memo, body.ref,
  body.params == null ? null : JSON.stringify(body.params), body.challenge, body.sig, prev, hash, serverSign(hash), body.chainTx ?? null);
  return { id: Number(r.lastInsertRowid), hash };
}

function insertToken(serial, owner, rarity) {
  q.run('INSERT INTO tokens (serial, owner_id, rarity, rarity_rank, minted_at) VALUES (?,?,?,?,?)', serial, owner, rarity.id, rarity.rank, now());
}

// Ledger operations run one at a time: each plans against the current holdings, executes
// on-chain, then mirrors the result here, so the plan can never go stale in between.
let lock = Promise.resolve();
export function serialized(fn) {
  const p = lock.then(fn, fn);
  lock = p.catch(() => {});
  return p;
}

/** Register (or re-key) a citizen's Aurum wallet on-chain. */
export const registerWallet = (userId, address) => serialized(() => chain.registerCitizen(userId, address));
export const setCitizenActive = (userId, active) => serialized(() => chain.setActive(userId, active));

/** Citizenship grant: the contract mints exactly one grant per citizen, ever. */
export function grantCitizenship(userId, memo = 'Citizenship grant') {
  return serialized(async () => {
    const g = await chain.grant(userId);
    return tx(() => {
      let value = 0;
      for (let s = g.first; s < g.first + g.count; s++) { const r = rarityFor(s); insertToken(s, userId, r); value += r.value; }
      if (value !== g.value) throw new Error(`Chain and ledger disagree on the grant value (${g.value} vs ${value})`);
      const entry = append({ type: 'mint', to: userId, amount: value, serials: compress(range(g.first, g.count)), memo: `${memo}: ${g.count} Sigils worth ${value} ${SYM}`, chainTx: g.hash });
      return { ...entry, count: g.count, value, chainTx: g.hash };
    });
  });
}
const range = (first, count) => Array.from({ length: count }, (_, i) => first + i);

export function balance(userId) {
  const r = q.get(`SELECT COALESCE(SUM(CASE WHEN locked_order IS NULL THEN ${VALUE_SQL} END), 0) free,
    COALESCE(SUM(CASE WHEN locked_order IS NOT NULL THEN ${VALUE_SQL} END), 0) locked, COUNT(*) tokens FROM tokens WHERE owner_id = ?`, userId);
  return { available: r.free, inEscrow: r.locked, tokens: r.tokens };
}

const holdingsOf = (userId) => q.all('SELECT serial, rarity FROM tokens WHERE owner_id = ? AND locked_order IS NULL', userId)
  .map((t) => ({ serial: t.serial, rarity: t.rarity, rank: RANK[t.rarity].rank, value: VALUES[t.rarity] }));

/**
 * Mint exchange plan for one Sigil: it goes into the Treasury reserve, and the change comes
 * from lower-value reserve Sigils first, then newly minted commons. Mutates the working sets.
 */
function planBreak(token, reserve, nextFresh) {
  const v = token.value;
  if (v <= VALUES.common) throw fail('A common Sigil cannot be broken into smaller change');
  const change = [];
  let left = v;
  for (const r of RARITIES.filter((x) => x.value < v)) {
    while (left >= r.value) {
      const i = reserve.findIndex((t) => t.rarity === r.id);
      if (i < 0) break;
      change.push(reserve.splice(i, 1)[0]); left -= r.value;
    }
  }
  reserve.push(token);
  reserve.sort((a, b) => a.serial - b.serial);
  const fresh = range(nextFresh, left).map((serial) => ({ serial, rarity: 'common', rank: 1, value: VALUES.common, fresh: true }));
  return { brk: { serial: token.serial, change: change.map((t) => t.serial), mintCommons: left }, gained: [...change, ...fresh] };
}

/**
 * Choose Sigils worth exactly `amount` SGL. Commonest first so collectibles are kept; if
 * exact change is impossible, the smallest sufficient Sigil is broken at the Mint first.
 * Pure: returns { serials, breaks } for the contract without changing anything.
 */
async function plan(userId, amount, { protectRare = false, serials = null } = {}) {
  let holdings = holdingsOf(userId);
  if (serials?.length) {
    const want = [...new Set(serials.map(Number))];
    const rows = want.map((s) => holdings.find((h) => h.serial === s));
    if (rows.some((r) => !r)) throw fail('You do not own all of the selected Sigils');
    const total = rows.reduce((a, r) => a + r.value, 0);
    if (total !== amount) throw fail(`The selected Sigils are worth ${total} ${SYM}, not ${amount}`);
    return { serials: want, breaks: [], picked: true };
  }
  const reserve = q.all('SELECT serial, rarity FROM tokens WHERE owner_id = ? ORDER BY serial', TREASURY).map((t) => ({ serial: t.serial, rarity: t.rarity, rank: RANK[t.rarity].rank, value: VALUES[t.rarity] }));
  let nextFresh = await chain.nextSerial();
  const breaks = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const rows = holdings.filter((h) => !protectRare || h.rank <= 2).sort((a, b) => a.rank - b.rank || b.serial - a.serial);
    const have = rows.reduce((a, r) => a + r.value, 0);
    if (have < amount) {
      throw fail(protectRare
        ? `Your common and uncommon Sigils are worth ${have} ${SYM}. Untick "protect rare Sigils" or pick Sigils manually.`
        : `Insufficient balance (available ${have} ${SYM})`);
    }
    const chosen = [];
    let sum = 0;
    for (const r of rows) { if (sum >= amount) break; chosen.push(r); sum += r.value; }
    // Overshoot: hand back smaller chosen Sigils that fit inside the excess.
    let over = sum - amount;
    for (const r of [...chosen].sort((a, b) => b.value - a.value)) {
      if (over > 0 && r.value <= over && r !== chosen.at(-1)) { chosen.splice(chosen.indexOf(r), 1); over -= r.value; }
    }
    if (over === 0) return { serials: chosen.map((r) => r.serial), breaks };
    // No exact change: break the last (largest) chosen Sigil into change and try again.
    const big = chosen.at(-1);
    const { brk, gained } = planBreak(big, reserve, nextFresh);
    nextFresh += brk.mintCommons;
    breaks.push(brk);
    holdings = holdings.filter((h) => h !== big).concat(gained);
  }
  throw fail('Could not make exact change — try picking Sigils manually');
}

/** Mirror executed Mint exchanges in the database and journal. */
function applyBreaks(userId, breaks, minted, chainTx, reason) {
  const fresh = minted.flatMap((m) => range(m.first, m.count));
  for (const b of breaks) {
    const t = q.get('SELECT rarity FROM tokens WHERE serial = ?', b.serial);
    const v = VALUES[t.rarity];
    q.run('UPDATE tokens SET owner_id = ? WHERE serial = ?', TREASURY, b.serial);
    append({ type: 'exchange_in', from: userId, to: TREASURY, amount: v, serials: String(b.serial), memo: `Sigil #${b.serial} (${t.rarity}) deposited at the Mint — ${reason}`, chainTx });
    for (const s of b.change) q.run('UPDATE tokens SET owner_id = ? WHERE serial = ?', userId, s);
    const made = fresh.splice(0, b.mintCommons);
    if (made.length !== b.mintCommons) throw new Error('Chain minted a different amount of change than planned');
    for (const s of made) insertToken(s, userId, RANK.common);
    append({ type: 'exchange_out', from: TREASURY, to: userId, amount: v, serials: compress([...b.change, ...made]),
      memo: `Change for Sigil #${b.serial}: ${b.change.length + made.length} Sigils${made.length ? ` (${made.length} newly minted Mint-change commons)` : ''}`, chainTx });
  }
}

// ---------------------------------------------------------------- signed intents
// What a citizen's Sigil wallet signs for each operation. The server rebuilds the message
// from the operation's own parameters, so a signature can only ever authorise that exact
// payment; the contract checks it again on-chain.
const DEADLINE_SECONDS = 15 * 60;
export function intentFor(userId, op, params, { nonce, deadline }) {
  const p = params || {};
  if (op === 'wallet.break') {
    return { primaryType: 'Exchange', message: { from: userId, serial: Number(p.serial), nonce: Number(nonce), deadline: Number(deadline) } };
  }
  let to; let ref; let serials = null;
  if (op === 'wallet.send') {
    const r = q.get("SELECT id FROM users WHERE username = ? AND status = 'citizen'", String(p.to || ''));
    if (!r) throw fail('Recipient is not a citizen');
    to = r.id; ref = chain.refOf('wallet.send');
    serials = Array.isArray(p.serials) && p.serials.length ? [...new Set(p.serials.map(Number))] : null;
  } else if (op === 'market.buy') {
    to = chain.ESCROW_ID; ref = chain.refOf(`market.buy:${Number(p.listingId)}`);
  } else throw fail('This operation has no Sigil payment');
  const amount = op === 'market.buy' ? Number(p.unitPrice) * Number(p.quantity) : Number(p.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw fail('Invalid amount');
  return { primaryType: 'Transfer', serials, message: { from: userId, to, amount, serialsHash: chain.serialsHash(serials), ref, nonce: Number(nonce), deadline: Number(deadline) } };
}
export async function newIntent(userId, op, params) {
  const nonce = await chain.nonceOf(userId);
  const { primaryType, message } = intentFor(userId, op, params, { nonce, deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS });
  return { domain: chain.chainInfo().domain, types: { [primaryType]: chain.TYPES[primaryType] }, primaryType, message };
}
function checkSigned(user, op, params, signed) {
  if (!signed?.sig) throw fail('This payment must be signed with your Aurum wallet (from your .access key)');
  if (!user.chain_address) throw fail('Your Aurum wallet is not linked yet');
  const it = intentFor(user.id, op, params, signed);
  if (!chain.verifyIntent(it.primaryType, it.message, signed.sig, user.chain_address)) throw fail('The Aurum wallet signature does not match this payment');
  return it;
}

// ---------------------------------------------------------------- operations

export function transfer({ user, to, amount, memo, options, auth, op, params }) {
  if (user.id === to) throw fail('Cannot send Sigils to yourself');
  return serialized(async () => {
    const it = checkSigned(user, op, params, auth?.chain);
    const p = await plan(user.id, amount, options);
    if (p.picked && JSON.stringify(p.serials) !== JSON.stringify(it.serials)) throw fail('Selected Sigils do not match the signature');
    const r = await chain.transfer(it.message, auth.chain.sig, p.serials, p.breaks);
    return tx(() => {
      applyBreaks(user.id, p.breaks, r.minted, r.hash, 'change for a payment');
      for (const s of p.serials) q.run('UPDATE tokens SET owner_id = ? WHERE serial = ?', to, s);
      return append({ type: 'transfer', from: user.id, to, amount, serials: compress(p.serials), memo, params: { op, params }, challenge: auth?.challenge, sig: auth?.signature, chainTx: r.hash });
    });
  });
}

/**
 * Pay into marketplace escrow. `check()` re-validates the order under the ledger lock before
 * anything moves; `createOrder()` runs in the same database transaction as the mirror.
 */
export function lockForOrder({ user, seller, amount, auth, op, params, check, createOrder }) {
  return serialized(async () => {
    check();
    const it = checkSigned(user, op, params, auth?.chain);
    // Keep the buyer's collectibles if commons and uncommons can cover it.
    let p;
    try { p = await plan(user.id, amount, { protectRare: true }); } catch { p = await plan(user.id, amount, { protectRare: false }); }
    const r = await chain.transfer(it.message, auth.chain.sig, p.serials, p.breaks);
    return tx(() => {
      const orderId = createOrder();
      applyBreaks(user.id, p.breaks, r.minted, r.hash, 'change for a purchase');
      for (const s of p.serials) q.run('UPDATE tokens SET locked_order = ? WHERE serial = ?', orderId, s);
      append({ type: 'escrow', from: user.id, to: seller, amount, serials: compress(p.serials), memo: `Escrow for order #${orderId}`, ref: `order:${orderId}`, params: { op, params }, challenge: auth?.challenge, sig: auth?.signature, chainTx: r.hash });
      return orderId;
    });
  });
}

/** Release escrow to the seller or refund it to the buyer; `then()` runs in the same DB transaction. */
export function settleOrder(orderId, outcome /* 'release' | 'refund' */, then = () => {}) {
  return serialized(async () => {
    const o = q.get('SELECT * FROM orders WHERE id = ?', orderId);
    const serials = q.all('SELECT serial FROM tokens WHERE locked_order = ?', orderId).map((r) => r.serial);
    const to = outcome === 'release' ? o.seller_id : o.buyer_id;
    const r = await chain.releaseEscrow(to, serials, chain.refOf(`order:${orderId}`));
    return tx(() => {
      for (const s of serials) q.run('UPDATE tokens SET owner_id = ?, locked_order = NULL WHERE serial = ?', to, s);
      append({ type: outcome === 'release' ? 'escrow_release' : 'escrow_refund', from: o.buyer_id, to, amount: valueOfSerials(serials), serials: compress(serials), memo: `Order #${orderId} ${outcome === 'release' ? 'payment released to seller' : 'refunded to buyer'}`, ref: `order:${orderId}`, chainTx: r.hash });
      return then();
    });
  });
}
const valueOfSerials = (serials) => serials.reduce((a, s) => a + VALUES[q.get('SELECT rarity FROM tokens WHERE serial = ?', s).rarity], 0);

/** Break one Sigil into change at the Mint, signed by the holder. */
export function breakSigil({ user, serial, auth, op, params }) {
  return serialized(async () => {
    const it = checkSigned(user, op, params, auth?.chain);
    const token = holdingsOf(user.id).find((h) => h.serial === serial);
    if (!token) throw fail('You do not hold that Sigil');
    const reserve = q.all('SELECT serial, rarity FROM tokens WHERE owner_id = ? ORDER BY serial', TREASURY).map((t) => ({ serial: t.serial, rarity: t.rarity, value: VALUES[t.rarity] }));
    const { brk } = planBreak(token, reserve, await chain.nextSerial());
    const r = await chain.exchange(it.message, auth.chain.sig, brk.change, brk.mintCommons);
    tx(() => applyBreaks(user.id, [brk], r.minted, r.hash, 'exchanged by the holder'));
    return { value: token.value, change: brk.change.length + brk.mintCommons, chainTx: r.hash };
  });
}

/**
 * Compare every Sigil's owner in this database with the contract. Escrowed Sigils are held
 * by the contract's ESCROW account; the Treasury reserve by its TREASURY account.
 */
export async function auditChain() {
  const rows = q.all('SELECT serial, owner_id, locked_order FROM tokens ORDER BY serial');
  const total = await chain.nextSerial() - 1;
  const owners = rows.length ? await chain.ownersOf(1, total) : [];
  const mismatches = [];
  if (total !== rows.length) mismatches.push({ issue: `Chain has ${total} Sigils, ledger has ${rows.length}` });
  for (const t of rows) {
    const want = t.locked_order ? 'escrow' : t.owner_id;
    const got = owners[t.serial - 1];
    if (got !== want && mismatches.length < 20) mismatches.push({ serial: t.serial, ledger: want, chain: got });
  }
  return { ...chain.chainInfo(), sigils: total, checked: rows.length, ok: mismatches.length === 0, mismatches };
}

/** Re-verify the whole chain: hashes, server signatures, and every citizen signature. */
export function verifyChain() {
  const keys = new Map(q.all('SELECT id, public_key FROM users').map((u) => [u.id, u.public_key]));
  let prev = '0'.repeat(64);
  let count = 0;
  const problems = [];
  for (const row of q.all('SELECT * FROM ledger ORDER BY id')) {
    count++;
    const body = {
      ts: row.ts, type: row.type, from: row.from_id, to: row.to_id, amount: row.amount, serials: row.serials,
      memo: row.memo, ref: row.ref, params: row.op_params ? JSON.parse(row.op_params) : null, challenge: row.challenge, sig: row.sender_sig,
      chainTx: row.chain_tx ?? undefined,
    };
    if (row.prev_hash !== prev) problems.push({ id: row.id, issue: 'Broken link to previous entry' });
    if (sha256(row.prev_hash + canonical(body)) !== row.hash) problems.push({ id: row.id, issue: 'Entry contents do not match its hash' });
    if (!serverVerify(row.hash, row.server_sig)) problems.push({ id: row.id, issue: 'Invalid server signature' });
    if (row.sender_sig) {
      const p = body.params;
      const bound = row.challenge.split('|')[3] === opHash(p.op, p.params);
      // Signatures made with a since-rotated key cannot be checked against the current key; report rather than fail.
      if (!bound) problems.push({ id: row.id, issue: 'Citizen signature not bound to these parameters' });
      else if (!verifyUserSignature(keys.get(row.from_id) || '', row.challenge, row.sender_sig)) problems.push({ id: row.id, issue: 'Citizen signature does not match current public key (key may have been reissued)', soft: true });
    }
    prev = row.hash;
  }
  return { entries: count, head: prev, ok: problems.filter((p) => !p.soft).length === 0, problems };
}

export function supplyStats() {
  const s = q.get(`SELECT COUNT(*) tokens, COALESCE(SUM(${VALUE_SQL}),0) value,
    COALESCE(SUM(CASE WHEN owner_id = ${TREASURY} THEN ${VALUE_SQL} END),0) reserve,
    COALESCE(SUM(CASE WHEN locked_order IS NOT NULL THEN ${VALUE_SQL} END),0) escrow FROM tokens`);
  const byRarity = Object.fromEntries(q.all('SELECT rarity, COUNT(*) c FROM tokens GROUP BY rarity').map((r) => [r.rarity, r.c]));
  const tx24 = q.get("SELECT COUNT(*) c, COALESCE(SUM(amount),0) v FROM ledger WHERE type IN ('transfer','escrow') AND ts > ?", now() - 864e5);
  return {
    tokens: s.tokens, totalValue: s.value, reserveValue: s.reserve, circulating: s.value - s.reserve, escrow: s.escrow,
    byRarity, values: VALUES, transactions24h: tx24.c, volume24h: tx24.v, entries: q.get('SELECT COUNT(*) c FROM ledger').c,
  };
}
