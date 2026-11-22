import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { q, tx, now, audit } from '../db.js';
import { UPLOAD_DIR } from '../config.js';
import { requireCitizen, requirePassport, requireAccess, requireOfficial, isOfficial } from '../auth.js';
import { h, str, int, bad, forbidden, notFound, oneOf, page, memoryUpload, saveImage } from '../util.js';
import { lockForOrder, settleOrder, balance } from '../ledger.js';

const r = Router();
export const CATEGORIES = ['art', 'collectibles', 'digital', 'electronics', 'fashion', 'home', 'books', 'services', 'crafts', 'other'];
const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'not_applicable'];
const DELIVERY = ['digital', 'shipping', 'pickup', 'service'];

const seller = (id) => {
  const u = q.get('SELECT id, username, display_name FROM users WHERE id = ?', id);
  const rt = q.get('SELECT AVG(rating) avg, COUNT(rating) n FROM orders WHERE seller_id = ? AND rating IS NOT NULL', id);
  const sales = q.get("SELECT COUNT(*) c FROM orders WHERE seller_id = ? AND status = 'completed'", id).c;
  return u && { id: u.id, username: u.username, displayName: u.display_name, rating: rt.avg ? Math.round(rt.avg * 10) / 10 : null, ratings: rt.n, sales };
};
const shape = (l) => ({ ...l, images: JSON.parse(l.images) });

r.get('/meta', (_req, res) => res.json({ categories: CATEGORIES, conditions: CONDITIONS, delivery: DELIVERY }));

r.get('/listings', (req, res) => {
  const { limit, offset, page: p } = page(req, 24);
  const conds = [];
  const args = [];
  if (req.query.seller) { conds.push('u.username = ?'); args.push(req.query.seller); conds.push("l.status IN ('active','sold_out')"); } else conds.push("l.status = 'active'");
  if (CATEGORIES.includes(req.query.category)) { conds.push('l.category = ?'); args.push(req.query.category); }
  const term = String(req.query.q || '').trim();
  if (term) { conds.push('(l.title LIKE ? OR l.description LIKE ?)'); args.push(`%${term}%`, `%${term}%`); }
  if (req.query.min) { conds.push('l.price >= ?'); args.push(Number(req.query.min) || 0); }
  if (req.query.max) { conds.push('l.price <= ?'); args.push(Number(req.query.max) || 0); }
  const order = { new: 'l.created_at DESC', price_asc: 'l.price ASC', price_desc: 'l.price DESC', popular: 'l.views DESC' }[req.query.sort] || 'l.created_at DESC';
  const where = 'WHERE ' + conds.join(' AND ');
  const items = q.all(`SELECT l.id, l.title, l.price, l.category, l.images, l.delivery, l.item_condition, l.quantity, l.status, l.created_at, u.username seller
    FROM listings l JOIN users u ON u.id = l.seller_id ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, limit, offset).map(shape);
  const total = q.get(`SELECT COUNT(*) c FROM listings l JOIN users u ON u.id = l.seller_id ${where}`, ...args).c;
  res.json({ items, total, page: p, pages: Math.ceil(total / limit) });
});

r.get('/listings/:id', (req, res) => {
  const l = q.get('SELECT * FROM listings WHERE id = ?', Number(req.params.id));
  if (!l || (l.status === 'removed' && l.seller_id !== req.user?.id)) throw notFound('Listing not found');
  if (req.user?.id !== l.seller_id) q.run('UPDATE listings SET views = views + 1 WHERE id = ?', l.id);
  const more = q.all("SELECT id, title, price, images FROM listings WHERE seller_id = ? AND id != ? AND status = 'active' ORDER BY created_at DESC LIMIT 4", l.seller_id, l.id).map(shape);
  res.json({ ...shape(l), seller: seller(l.seller_id), more, mine: req.user?.id === l.seller_id });
});

const listingUpload = memoryUpload(5, 4).array('images', 4);
r.post('/listings', requirePassport, listingUpload, h(async (req, res) => {
  if (q.get("SELECT COUNT(*) c FROM listings WHERE seller_id = ? AND status = 'active'", req.user.id).c >= 50) throw bad('You can have at most 50 active listings');
  const title = str(req.body.title, 'Title', { min: 4, max: 100 });
  const description = str(req.body.description, 'Description', { min: 10, max: 5000 });
  const category = oneOf(req.body.category, 'Category', CATEGORIES);
  const price = int(req.body.price, 'Price', { min: 1, max: 1_000_000 });
  const quantity = int(req.body.quantity || 1, 'Quantity', { min: 1, max: 10_000 });
  const condition = oneOf(req.body.condition, 'Condition', CONDITIONS);
  const delivery = oneOf(req.body.delivery, 'Delivery', DELIVERY);
  const images = (req.files || []).map((f) => saveImage(f.buffer, UPLOAD_DIR));
  const info = q.run(`INSERT INTO listings (seller_id, title, description, category, price, quantity, item_condition, delivery, images, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, req.user.id, title, description, category, price, quantity, condition, delivery, JSON.stringify(images), now(), now());
  res.json({ id: Number(info.lastInsertRowid) });
}));

r.patch('/listings/:id', requireCitizen, (req, res) => {
  const l = q.get('SELECT * FROM listings WHERE id = ?', Number(req.params.id));
  if (!l) throw notFound();
  if (l.seller_id !== req.user.id && !isOfficial(req.user)) throw forbidden('Not your listing');
  const status = req.body.status ? oneOf(req.body.status, 'Status', ['active', 'paused', 'removed']) : l.status;
  const price = req.body.price != null ? int(req.body.price, 'Price', { min: 1, max: 1_000_000 }) : l.price;
  const quantity = req.body.quantity != null ? int(req.body.quantity, 'Quantity', { min: 0, max: 10_000 }) : l.quantity;
  const finalStatus = status === 'active' && quantity === 0 ? 'sold_out' : status;
  q.run('UPDATE listings SET status = ?, price = ?, quantity = ?, updated_at = ? WHERE id = ?', finalStatus, price, quantity, now(), l.id);
  if (l.seller_id !== req.user.id) audit(req.user.id, 'listing_moderated', { id: l.id, status });
  res.json({ ok: true });
});

// params: { listingId, quantity, unitPrice } — the price is in the signed challenge, so a seller
// who raises the price after you started checking out cannot charge you the new price.
r.post('/listings/:id/buy', requireAccess('market.buy', (req) => req.body.params), h(async (req, res) => {
  const p = req.access.params;
  if (Number(p.listingId) !== Number(req.params.id)) throw bad('Listing mismatch');
  const quantity = int(p.quantity, 'Quantity', { min: 1, max: 10_000 });
  const listing = () => q.get('SELECT * FROM listings WHERE id = ?', Number(p.listingId));
  const check = () => {
    const l = listing();
    if (!l || l.status !== 'active') throw bad('This listing is not available');
    if (l.seller_id === req.user.id) throw bad('You cannot buy your own listing');
    if (l.price !== Number(p.unitPrice)) throw bad(`The price changed to ${l.price}. Review and try again.`);
    if (quantity > l.quantity) throw bad(`Only ${l.quantity} left`);
    if (balance(req.user.id).available < l.price * quantity) throw bad('Insufficient Sigil balance');
    return l;
  };
  const l0 = check();
  const order = await lockForOrder({
    user: req.user, seller: l0.seller_id, amount: l0.price * quantity, auth: req.access, op: 'market.buy', params: p, check,
    createOrder: () => {
      const l = listing();
      const info = q.run('INSERT INTO orders (listing_id, buyer_id, seller_id, quantity, total, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', l.id, req.user.id, l.seller_id, quantity, l.price * quantity, now(), now());
      const left = l.quantity - quantity;
      q.run('UPDATE listings SET quantity = ?, status = ?, updated_at = ? WHERE id = ?', left, left === 0 ? 'sold_out' : 'active', now(), l.id);
      return Number(info.lastInsertRowid);
    },
  });
  audit(req.user.id, 'order_placed', { order });
  res.json({ ok: true, orderId: order });
}));

// ---------------------------------------------------------------- orders
const orderView = (o, uid) => {
  const l = q.get('SELECT id, title, images, delivery FROM listings WHERE id = ?', o.listing_id);
  return { ...o, listing: l && shape(l), buyer: seller(o.buyer_id), seller: seller(o.seller_id), role: o.buyer_id === uid ? 'buyer' : o.seller_id === uid ? 'seller' : 'official' };
};
function loadOrder(req, { allowOfficial = false } = {}) {
  const o = q.get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
  if (!o) throw notFound('Order not found');
  if (o.buyer_id !== req.user.id && o.seller_id !== req.user.id && !(allowOfficial && isOfficial(req.user))) throw forbidden('Not your order');
  return o;
}
const touch = (id, status) => q.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', status, now(), id);
const sysMsg = (orderId, userId, body) => q.run('INSERT INTO order_messages (order_id, user_id, body, created_at) VALUES (?,?,?,?)', orderId, userId, body, now());

r.get('/orders', requireCitizen, (req, res) => {
  const role = req.query.role === 'selling' ? 'seller_id' : 'buyer_id';
  res.json(q.all(`SELECT * FROM orders WHERE ${role} = ? ORDER BY updated_at DESC LIMIT 200`, req.user.id).map((o) => orderView(o, req.user.id)));
});
r.get('/orders/:id', requireCitizen, (req, res) => {
  const o = loadOrder(req, { allowOfficial: true });
  const messages = q.all('SELECT m.*, u.username FROM order_messages m JOIN users u ON u.id = m.user_id WHERE order_id = ? ORDER BY m.id', o.id);
  res.json({ ...orderView(o, req.user.id), messages });
});
r.post('/orders/:id/messages', requireCitizen, (req, res) => {
  const o = loadOrder(req, { allowOfficial: true });
  sysMsg(o.id, req.user.id, str(req.body.body, 'Message', { max: 2000 }));
  res.json({ ok: true });
});
r.post('/orders/:id/ship', requireCitizen, (req, res) => {
  const o = loadOrder(req);
  if (o.seller_id !== req.user.id) throw forbidden('Only the seller can mark an order delivered');
  if (o.status !== 'escrow') throw bad('Order is not awaiting delivery');
  const note = str(req.body.note, 'Delivery note', { max: 1000, optional: true });
  q.run("UPDATE orders SET status = 'shipped', ship_note = ?, updated_at = ? WHERE id = ?", note, now(), o.id);
  sysMsg(o.id, req.user.id, `📦 Marked as delivered${note ? `: ${note}` : ''}`);
  res.json({ ok: true });
});
// Escrow moves happen on-chain first, then the order is updated; claim() guards against a double settle.
const claim = (o, allowed) => { if (!allowed.includes(q.get('SELECT status FROM orders WHERE id = ?', o.id).status)) throw bad('Order was already settled'); };
r.post('/orders/:id/confirm', requirePassport, h(async (req, res) => {
  const o = loadOrder(req);
  if (o.buyer_id !== req.user.id) throw forbidden('Only the buyer can confirm receipt');
  if (!['escrow', 'shipped'].includes(o.status)) throw bad('Order cannot be confirmed in its current state');
  await settleOrder(o.id, 'release', () => { claim(o, ['escrow', 'shipped']); touch(o.id, 'completed'); sysMsg(o.id, req.user.id, '✅ Receipt confirmed — payment released to seller'); });
  res.json({ ok: true });
}));
r.post('/orders/:id/refund', requireCitizen, h(async (req, res) => {
  const o = loadOrder(req);
  if (o.seller_id !== req.user.id) throw forbidden('Only the seller can issue a refund');
  if (!['escrow', 'shipped', 'disputed'].includes(o.status)) throw bad('Order cannot be refunded in its current state');
  await settleOrder(o.id, 'refund', () => {
    claim(o, ['escrow', 'shipped', 'disputed']);
    touch(o.id, 'refunded');
    q.run("UPDATE listings SET quantity = quantity + ?, status = CASE WHEN status = 'sold_out' THEN 'active' ELSE status END WHERE id = ?", o.quantity, o.listing_id);
    sysMsg(o.id, req.user.id, '↩️ Seller refunded the order');
  });
  res.json({ ok: true });
}));
r.post('/orders/:id/dispute', requireCitizen, (req, res) => {
  const o = loadOrder(req);
  if (o.buyer_id !== req.user.id) throw forbidden('Only the buyer can open a dispute');
  if (!['escrow', 'shipped'].includes(o.status)) throw bad('Order cannot be disputed in its current state');
  const reason = str(req.body.reason, 'Reason', { min: 10, max: 2000 });
  touch(o.id, 'disputed');
  sysMsg(o.id, req.user.id, `⚠️ Dispute opened: ${reason}`);
  res.json({ ok: true });
});
r.post('/orders/:id/resolve', requireOfficial, h(async (req, res) => {
  const o = q.get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
  if (!o || o.status !== 'disputed') throw bad('Order is not in dispute');
  const outcome = oneOf(req.body.outcome, 'Outcome', ['release', 'refund']);
  const note = str(req.body.note, 'Ruling', { min: 5, max: 2000 });
  await settleOrder(o.id, outcome, () => {
    claim(o, ['disputed']);
    touch(o.id, outcome === 'release' ? 'completed' : 'refunded');
    sysMsg(o.id, req.user.id, `⚖️ Department of Commerce ruling (${outcome === 'release' ? 'paid to seller' : 'refunded to buyer'}): ${note}`);
  });
  audit(req.user.id, 'dispute_resolved', { order: o.id, outcome });
  res.json({ ok: true });
}));
r.post('/orders/:id/review', requireCitizen, (req, res) => {
  const o = loadOrder(req);
  if (o.buyer_id !== req.user.id || o.status !== 'completed') throw bad('You can review only completed purchases');
  if (o.rating) throw bad('You already reviewed this order');
  q.run('UPDATE orders SET rating = ?, review = ? WHERE id = ?', int(req.body.rating, 'Rating', { min: 1, max: 5 }), str(req.body.review, 'Review', { max: 1000, optional: true }), o.id);
  res.json({ ok: true });
});
r.get('/sellers/:username', (req, res) => {
  const u = q.get("SELECT id FROM users WHERE username = ? AND status = 'citizen'", req.params.username);
  if (!u) throw notFound('Seller not found');
  const reviews = q.all(`SELECT o.rating, o.review, o.updated_at, b.username buyer, l.title FROM orders o JOIN users b ON b.id = o.buyer_id JOIN listings l ON l.id = o.listing_id
    WHERE o.seller_id = ? AND o.rating IS NOT NULL ORDER BY o.updated_at DESC LIMIT 30`, u.id);
  res.json({ seller: seller(u.id), reviews });
});
r.get('/disputes', requireOfficial, (req, res) => {
  res.json(q.all("SELECT * FROM orders WHERE status = 'disputed' ORDER BY updated_at").map((o) => orderView(o, req.user.id)));
});

// Listing images are public; only serve files that a listing actually references.
r.get('/images/:name', (req, res) => {
  const name = path.basename(req.params.name);
  if (!/^[0-9a-f]{32}\.(jpg|png|webp|gif)$/.test(name)) throw notFound();
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) throw notFound();
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(file);
});

export default r;
