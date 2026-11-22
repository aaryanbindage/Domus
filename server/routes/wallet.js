import { Router } from 'express';
import { q, audit } from '../db.js';
import { NATION } from '../config.js';
import { requireCitizen, requireAccess } from '../auth.js';
import { h, str, int, bad, page } from '../util.js';
import { balance, transfer, breakSigil, newIntent, RARITIES } from '../ledger.js';
import { chainInfo, chainBalance, nonceOf, citizenOf } from '../chain.js';

const r = Router();

r.get('/', requireCitizen, (req, res) => {
  const counts = Object.fromEntries(q.all('SELECT rarity, COUNT(*) c FROM tokens WHERE owner_id = ? GROUP BY rarity', req.user.id).map((x) => [x.rarity, x.c]));
  res.json({ ...balance(req.user.id), byRarity: counts, currency: NATION.currency, rarities: RARITIES.map((x) => ({ id: x.id, value: x.value, odds: x.odds })) });
});

r.get('/tokens', requireCitizen, (req, res) => {
  const { limit, offset, page: p } = page(req, 60);
  const rarity = RARITIES.some((x) => x.id === req.query.rarity) ? req.query.rarity : null;
  const where = 'WHERE owner_id = ?' + (rarity ? ' AND rarity = ?' : '');
  const args = rarity ? [req.user.id, rarity] : [req.user.id];
  const items = q.all(`SELECT serial, rarity, minted_at, locked_order FROM tokens ${where} ORDER BY rarity_rank DESC, serial LIMIT ? OFFSET ?`, ...args, limit, offset);
  const total = q.get(`SELECT COUNT(*) c FROM tokens ${where}`, ...args).c;
  res.json({ items, total, page: p, pages: Math.ceil(total / limit) });
});

r.get('/history', requireCitizen, (req, res) => {
  const { limit, offset, page: p } = page(req, 25);
  const items = q.all(`SELECT l.id, l.ts, l.type, l.from_id, l.to_id, l.amount, l.memo, l.ref, l.hash,
      uf.username from_user, ut.username to_user FROM ledger l
      LEFT JOIN users uf ON uf.id = l.from_id LEFT JOIN users ut ON ut.id = l.to_id
      WHERE l.from_id = ? OR l.to_id = ? ORDER BY l.id DESC LIMIT ? OFFSET ?`, req.user.id, req.user.id, limit, offset);
  const total = q.get('SELECT COUNT(*) c FROM ledger WHERE from_id = ? OR to_id = ?', req.user.id, req.user.id).c;
  res.json({ items, total, page: p, pages: Math.ceil(total / limit) });
});

r.get('/lookup/:username', requireCitizen, (req, res) => {
  const u = q.get("SELECT username, display_name, passport_no FROM users WHERE username = ? AND status = 'citizen'", req.params.username);
  res.json(u ? { found: true, username: u.username, displayName: u.display_name, passportNo: u.passport_no } : { found: false });
});

// params: { to, amount, memo, protectRare, serials? } — all bound into the signed challenge.
r.post('/send', requireAccess('wallet.send', (req) => req.body.params), h(async (req, res) => {
  const p = req.access.params;
  const amount = int(p.amount, 'Amount', { min: 1, max: 1_000_000 });
  const memo = str(p.memo, 'Memo', { max: 140, optional: true });
  const to = q.get("SELECT id, username FROM users WHERE username = ? AND status = 'citizen'", String(p.to || ''));
  if (!to) throw bad('Recipient is not a citizen');
  const serials = Array.isArray(p.serials) && p.serials.length ? p.serials.map(Number) : null;
  const entry = await transfer({ user: req.user, to: to.id, amount, memo, options: { protectRare: !!p.protectRare, serials }, auth: req.access, op: 'wallet.send', params: p });
  audit(req.user.id, 'transfer', { to: to.id, amount, ledger: entry.id });
  res.json({ ok: true, ledgerId: entry.id, hash: entry.hash, chainTx: entry.chainTx, balance: balance(req.user.id) });
}));

// Break one Sigil into change at the Mint. The holder signs it, because on-chain only they can move their Sigils.
r.post('/break', requireAccess('wallet.break', (req) => req.body.params), h(async (req, res) => {
  const p = req.access.params;
  const result = await breakSigil({ user: req.user, serial: int(p.serial, 'Sigil'), auth: req.access, op: 'wallet.break', params: p });
  audit(req.user.id, 'sigil_broken', { serial: p.serial, ...result });
  res.json({ ok: true, ...result, balance: balance(req.user.id) });
}));

// ---------------------------------------------------------------- the built-in Sigil wallet
// Citizens never need wallet software: their signing key is derived in the browser from the
// .access key, and the Treasury relays their signed payments and pays the gas.
r.get('/chain', requireCitizen, h(async (req, res) => {
  const [onChain, nonce, citizen] = await Promise.all([chainBalance(req.user.id), nonceOf(req.user.id), citizenOf(req.user.id)]);
  res.json({ ...chainInfo(), citizenId: req.user.id, address: req.user.chain_address, nonce, onChain, citizen, ledger: balance(req.user.id) });
}));
// The exact message the citizen's wallet must sign for an operation (checked again on-chain).
r.post('/chain/intent', requireCitizen, h(async (req, res) => {
  const op = String(req.body.op || '');
  if (!['wallet.send', 'wallet.break', 'market.buy'].includes(op)) throw bad('This operation has no Sigil payment');
  res.json(await newIntent(req.user.id, op, req.body.params || {}));
}));

export default r;
