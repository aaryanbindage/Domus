import { Router } from 'express';
import { q, audit } from '../db.js';
import { NATION } from '../config.js';
import { requireCitizen, requireAccess } from '../auth.js';
import { h, str, int, bad, page } from '../util.js';
import { balance, transfer, breakSigil, RARITIES } from '../ledger.js';

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
  const entry = transfer({ from: req.user.id, to: to.id, amount, memo, options: { protectRare: !!p.protectRare, serials }, auth: req.access, op: 'wallet.send', params: p });
  audit(req.user.id, 'transfer', { to: to.id, amount, ledger: entry.id });
  res.json({ ok: true, ledgerId: entry.id, hash: entry.hash, balance: balance(req.user.id) });
}));

// Break one Sigil into change at the Mint (value-neutral, so no .access signature needed).
r.post('/break', requireCitizen, (req, res) => {
  const result = breakSigil(req.user.id, int(req.body.serial, 'Sigil'), { reason: 'Exchanged by the holder' });
  audit(req.user.id, 'sigil_broken', { serial: req.body.serial, ...result });
  res.json({ ok: true, ...result, balance: balance(req.user.id) });
});

export default r;
