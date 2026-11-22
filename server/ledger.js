// The Sigil ledger. Every Sigil is a numbered collectible with a rarity derived from
// its serial. Every movement is a hash-chained, server-signed ledger entry; transfers
// initiated by citizens also carry the citizen's own ECDSA signature from their .access key.
import crypto from 'node:crypto';
import { q, tx, now } from './db.js';
import { canonical, sha256, serverSign, serverVerify, verifyUserSignature, opHash } from './security.js';
import { NATION } from './config.js';

export const RARITIES = [
  { id: 'legendary', rank: 5, odds: 0.002 },
  { id: 'epic', rank: 4, odds: 0.01 },
  { id: 'rare', rank: 3, odds: 0.048 },
  { id: 'uncommon', rank: 2, odds: 0.16 },
  { id: 'common', rank: 1, odds: 1 },
];
export function rarityFor(serial) {
  const r = crypto.createHash('sha256').update(`sigil:${serial}`).digest().readUInt32BE(0) / 2 ** 32;
  let acc = 0;
  for (const t of RARITIES) { acc += t.odds; if (r < acc) return t; }
  return RARITIES.at(-1);
}

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

export function mint(userId, amount, memo = 'Citizenship grant') {
  return tx(() => {
    const start = (q.get('SELECT MAX(serial) m FROM tokens')?.m || 0) + 1;
    const serials = [];
    for (let s = start; s < start + amount; s++) {
      const r = rarityFor(s);
      q.run('INSERT INTO tokens (serial, owner_id, rarity, rarity_rank, minted_at) VALUES (?,?,?,?,?)', s, userId, r.id, r.rank, now());
      serials.push(s);
    }
    return append({ type: 'mint', to: userId, amount, serials: compress(serials), memo });
  });
}

export function balance(userId) {
  const r = q.get(`SELECT SUM(locked_order IS NULL) free, SUM(locked_order IS NOT NULL) locked FROM tokens WHERE owner_id = ?`, userId);
  return { available: r?.free || 0, inEscrow: r?.locked || 0 };
}

/** Choose which Sigils leave a wallet: commons first so collectibles are kept. */
function pick(userId, amount, { protectRare = false, serials = null } = {}) {
  let rows;
  if (serials?.length) {
    const want = [...new Set(serials.map(Number))];
    rows = want.map((s) => q.get('SELECT serial FROM tokens WHERE serial = ? AND owner_id = ? AND locked_order IS NULL', s, userId)).filter(Boolean);
    if (rows.length !== want.length || want.length !== amount) throw Object.assign(new Error('You do not own all of the selected Sigils'), { status: 400 });
  } else {
    rows = q.all(`SELECT serial FROM tokens WHERE owner_id = ? AND locked_order IS NULL ${protectRare ? 'AND rarity_rank <= 2' : ''}
      ORDER BY rarity_rank ASC, serial DESC LIMIT ?`, userId, amount);
    if (rows.length < amount) {
      throw Object.assign(new Error(protectRare
        ? `Not enough common/uncommon Sigils (have ${rows.length}). Untick "protect rare Sigils" or pick tokens manually.`
        : `Insufficient balance (have ${rows.length} ${NATION.currency.symbol})`), { status: 400 });
    }
  }
  return rows.map((r) => r.serial);
}

export function transfer({ from, to, amount, memo, options, auth, op, params }) {
  if (from === to) throw Object.assign(new Error('Cannot send Sigils to yourself'), { status: 400 });
  return tx(() => {
    const serials = pick(from, amount, options);
    for (const s of serials) q.run('UPDATE tokens SET owner_id = ? WHERE serial = ?', to, s);
    return append({ type: 'transfer', from, to, amount, serials: compress(serials), memo, params: { op, params }, challenge: auth?.challenge, sig: auth?.signature });
  });
}

export function lockForOrder({ buyer, seller, amount, orderId, auth, op, params }) {
  return tx(() => {
    const serials = pick(buyer, amount, { protectRare: false });
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
    return append({ type: outcome === 'release' ? 'escrow_release' : 'escrow_refund', from: o.buyer_id, to, amount: serials.length, serials: compress(serials), memo: `Order #${orderId} ${outcome === 'release' ? 'payment released to seller' : 'refunded to buyer'}`, ref: `order:${orderId}` });
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
      const bound = row.challenge.split('.')[3] === opHash(p.op, p.params);
      // Signatures made with a since-rotated key cannot be checked against the current key; report rather than fail.
      if (!bound) problems.push({ id: row.id, issue: 'Citizen signature not bound to these parameters' });
      else if (!verifyUserSignature(keys.get(row.from_id) || '', row.challenge, row.sender_sig)) problems.push({ id: row.id, issue: 'Citizen signature does not match current public key (key may have been reissued)', soft: true });
    }
    prev = row.hash;
  }
  return { entries: count, head: prev, ok: problems.filter((p) => !p.soft).length === 0, problems };
}

export function supplyStats() {
  const total = q.get('SELECT COUNT(*) c FROM tokens').c;
  const escrow = q.get('SELECT COUNT(*) c FROM tokens WHERE locked_order IS NOT NULL').c;
  const byRarity = Object.fromEntries(q.all('SELECT rarity, COUNT(*) c FROM tokens GROUP BY rarity').map((r) => [r.rarity, r.c]));
  const tx24 = q.get("SELECT COUNT(*) c, COALESCE(SUM(amount),0) v FROM ledger WHERE type IN ('transfer','escrow') AND ts > ?", now() - 864e5);
  return { total, escrow, byRarity, transactions24h: tx24.c, volume24h: tx24.v, entries: q.get('SELECT COUNT(*) c FROM ledger').c };
}
