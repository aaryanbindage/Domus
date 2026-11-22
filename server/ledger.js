// The Sigil ledger. Every Sigil is a numbered collectible whose rarity is derived from
// its serial, and each rarity has a fixed face value in SGL. Balances and prices are
// in SGL value. Every movement is a hash-chained, server-signed ledger entry; transfers
// initiated by citizens also carry the citizen's own ECDSA signature from their .access key.
import crypto from 'node:crypto';
import { q, tx, now } from './db.js';
import { canonical, sha256, serverSign, serverVerify, verifyUserSignature, opHash } from './security.js';
import { NATION } from './config.js';

/** Owner id of the Treasury reserve (tokens out of circulation). */
export const TREASURY = 0;
const VALUES = NATION.currency.values;

export const RARITIES = [
  { id: 'legendary', rank: 5, odds: 0.002 },
  { id: 'epic', rank: 4, odds: 0.01 },
  { id: 'rare', rank: 3, odds: 0.048 },
  { id: 'uncommon', rank: 2, odds: 0.16 },
  { id: 'common', rank: 1, odds: 1 },
].map((r) => ({ ...r, value: VALUES[r.id] }));
const RANK = Object.fromEntries(RARITIES.map((r) => [r.id, r]));
export const valueOf = (rarity) => VALUES[rarity];
/** SQL expression giving the SGL value of a tokens row. */
const VALUE_SQL = `CASE rarity ${RARITIES.map((r) => `WHEN '${r.id}' THEN ${r.value}`).join(' ')} END`;

export function rarityFor(serial) {
  const r = crypto.createHash('sha256').update(`sigil:${serial}`).digest().readUInt32BE(0) / 2 ** 32;
  let acc = 0;
  for (const t of RARITIES) { acc += t.odds; if (r < acc) return t; }
  return RARITIES.at(-1);
}
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
    params: entry.params ?? null, challenge: entry.challenge ?? null, sig: entry.sig ?? null,
  };
  const hash = sha256(prev + canonical(body));
  const r = q.run(`INSERT INTO ledger (ts,type,from_id,to_id,amount,serials,memo,ref,op_params,challenge,sender_sig,prev_hash,hash,server_sig)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ts, body.type, body.from, body.to, body.amount, body.serials, body.memo, body.ref,
  body.params == null ? null : JSON.stringify(body.params), body.challenge, body.sig, prev, hash, serverSign(hash));
  return { id: Number(r.lastInsertRowid), hash };
}

const nextSerial = () => (q.get('SELECT MAX(serial) m FROM tokens')?.m || 0) + 1;
function insertToken(serial, owner, rarity) {
  q.run('INSERT INTO tokens (serial, owner_id, rarity, rarity_rank, minted_at) VALUES (?,?,?,?,?)', serial, owner, rarity.id, rarity.rank, now());
}

/** Citizenship grant: `count` new Sigils, each with the rarity fixed by its serial. */
export function mint(userId, count, memo = 'Citizenship grant') {
  return tx(() => {
    const start = nextSerial();
    const serials = [];
    let value = 0;
    for (let s = start; s < start + count; s++) {
      const r = rarityFor(s);
      insertToken(s, userId, r);
      serials.push(s); value += r.value;
    }
    const entry = append({ type: 'mint', to: userId, amount: value, serials: compress(serials), memo: `${memo}: ${count} Sigils worth ${value} ${NATION.currency.symbol}` });
    return { ...entry, count, value };
  });
}

export function balance(userId) {
  const r = q.get(`SELECT COALESCE(SUM(CASE WHEN locked_order IS NULL THEN ${VALUE_SQL} END), 0) free,
    COALESCE(SUM(CASE WHEN locked_order IS NOT NULL THEN ${VALUE_SQL} END), 0) locked, COUNT(*) tokens FROM tokens WHERE owner_id = ?`, userId);
  return { available: r.free, inEscrow: r.locked, tokens: r.tokens };
}

const spendable = (userId, protectRare) => q.all(`SELECT serial, rarity FROM tokens WHERE owner_id = ? AND locked_order IS NULL ${protectRare ? 'AND rarity_rank <= 2' : ''}
  ORDER BY rarity_rank ASC, serial DESC`, userId).map((t) => ({ ...t, value: VALUES[t.rarity] }));

/**
 * Mint exchange: break one Sigil into change of the same total value, like breaking a
 * banknote. The broken Sigil goes into the Treasury reserve (out of circulation, still a
 * collectible); the change comes from lower-value Sigils already in the reserve, topped up
 * with newly minted commons. Circulating value is unchanged.
 */
export function breakSigil(userId, serial, { reason = 'Change for a payment' } = {}) {
  return tx(() => {
    const t = q.get('SELECT * FROM tokens WHERE serial = ? AND owner_id = ? AND locked_order IS NULL', serial, userId);
    if (!t) throw fail('You do not hold that Sigil');
    const v = VALUES[t.rarity];
    if (v <= VALUES.common) throw fail('A common Sigil cannot be broken into smaller change');
    q.run('UPDATE tokens SET owner_id = ? WHERE serial = ?', TREASURY, serial);
    append({ type: 'exchange_in', from: userId, to: TREASURY, amount: v, serials: String(serial), memo: `Sigil #${serial} (${t.rarity}) deposited at the Mint — ${reason}` });
    // Change: largest reserve denominations below v first, then fresh commons for the rest.
    const change = [];
    let left = v;
    for (const r of RARITIES.filter((x) => x.value < v)) {
      while (left >= r.value) {
        const res = q.get('SELECT serial FROM tokens WHERE owner_id = ? AND rarity = ? ORDER BY serial LIMIT 1', TREASURY, r.id);
        if (!res) break;
        q.run('UPDATE tokens SET owner_id = ? WHERE serial = ?', userId, res.serial);
        change.push(res.serial); left -= r.value;
      }
    }
    const fresh = [];
    for (let s = nextSerial(); left > 0; s++, left--) { insertToken(s, userId, RANK.common); fresh.push(s); }
    change.push(...fresh);
    append({ type: 'exchange_out', from: TREASURY, to: userId, amount: v, serials: compress(change),
      memo: `Change for Sigil #${serial}: ${change.length} Sigils${fresh.length ? ` (${fresh.length} newly minted Mint-change commons)` : ''}` });
    return { value: v, change: change.length };
  });
}

/**
 * Choose Sigils worth exactly `amount` SGL. Commonest first so collectibles are kept;
 * if exact change is impossible, the smallest sufficient Sigil is broken at the Mint.
 */
function pick(userId, amount, { protectRare = false, serials = null } = {}) {
  if (serials?.length) {
    const want = [...new Set(serials.map(Number))];
    const rows = want.map((s) => q.get('SELECT serial, rarity FROM tokens WHERE serial = ? AND owner_id = ? AND locked_order IS NULL', s, userId)).filter(Boolean);
    if (rows.length !== want.length) throw fail('You do not own all of the selected Sigils');
    const total = rows.reduce((a, r) => a + VALUES[r.rarity], 0);
    if (total !== amount) throw fail(`The selected Sigils are worth ${total} ${NATION.currency.symbol}, not ${amount}`);
    return want;
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const rows = spendable(userId, protectRare);
    const have = rows.reduce((a, r) => a + r.value, 0);
    if (have < amount) {
      throw fail(protectRare
        ? `Your common and uncommon Sigils are worth ${have} ${NATION.currency.symbol}. Untick "protect rare Sigils" or pick Sigils manually.`
        : `Insufficient balance (available ${have} ${NATION.currency.symbol})`);
    }
    const chosen = [];
    let sum = 0;
    for (const r of rows) { if (sum >= amount) break; chosen.push(r); sum += r.value; }
    // Overshoot: hand back smaller chosen Sigils that fit inside the excess.
    let over = sum - amount;
    for (const r of [...chosen].sort((a, b) => b.value - a.value)) {
      if (over > 0 && r.value <= over && r !== chosen.at(-1)) { chosen.splice(chosen.indexOf(r), 1); over -= r.value; }
    }
    if (over === 0) return chosen.map((r) => r.serial);
    // No exact change: break the last (largest) chosen Sigil into change and try again.
    breakSigil(userId, chosen.at(-1).serial);
  }
  throw fail('Could not make exact change — try picking Sigils manually');
}

const valueOfSerials = (serials) => serials.reduce((a, s) => a + VALUES[q.get('SELECT rarity FROM tokens WHERE serial = ?', s).rarity], 0);

export function transfer({ from, to, amount, memo, options, auth, op, params }) {
  if (from === to) throw fail('Cannot send Sigils to yourself');
  return tx(() => {
    const serials = pick(from, amount, options);
    for (const s of serials) q.run('UPDATE tokens SET owner_id = ? WHERE serial = ?', to, s);
    return append({ type: 'transfer', from, to, amount, serials: compress(serials), memo, params: { op, params }, challenge: auth?.challenge, sig: auth?.signature });
  });
}

export function lockForOrder({ buyer, seller, amount, orderId, auth, op, params }) {
  return tx(() => {
    // Keep the buyer's collectibles if commons and uncommons can cover it.
    let serials;
    try { serials = pick(buyer, amount, { protectRare: true }); } catch { serials = pick(buyer, amount, { protectRare: false }); }
    for (const s of serials) q.run('UPDATE tokens SET locked_order = ? WHERE serial = ?', orderId, s);
    return append({ type: 'escrow', from: buyer, to: seller, amount, serials: compress(serials), memo: `Escrow for order #${orderId}`, ref: `order:${orderId}`, params: { op, params }, challenge: auth?.challenge, sig: auth?.signature });
  });
}

export function settleOrder(orderId, outcome /* 'release' | 'refund' */) {
  return tx(() => {
    const o = q.get('SELECT * FROM orders WHERE id = ?', orderId);
    const serials = q.all('SELECT serial FROM tokens WHERE locked_order = ?', orderId).map((r) => r.serial);
    const to = outcome === 'release' ? o.seller_id : o.buyer_id;
    for (const s of serials) q.run('UPDATE tokens SET owner_id = ?, locked_order = NULL WHERE serial = ?', to, s);
    return append({ type: outcome === 'release' ? 'escrow_release' : 'escrow_refund', from: o.buyer_id, to, amount: valueOfSerials(serials), serials: compress(serials), memo: `Order #${orderId} ${outcome === 'release' ? 'payment released to seller' : 'refunded to buyer'}`, ref: `order:${orderId}` });
  });
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
