import { Router } from 'express';
import { q, tx, now, audit, gazette } from '../db.js';
import { NATION, SECURITY } from '../config.js';
import { requireAuth, requireCitizen, requirePassport, requireAccess, requireOfficial, requireAdmin, isOfficial, isAdmin, publicUser } from '../auth.js';
import { h, str, int, bad, forbidden, notFound, oneOf, page } from '../util.js';
import { supplyStats, verifyChain, expand, rarityFor } from '../ledger.js';
import { readPassportToken } from '../passport.js';

const r = Router();
const userBrief = (id) => {
  const u = id && q.get('SELECT id, username, display_name, role, official_title FROM users WHERE id = ?', id);
  return u ? { id: u.id, username: u.username, displayName: u.display_name, role: u.role, officialTitle: u.official_title } : null;
};
const parseDept = (d) => d && { ...d, services: JSON.parse(d.services) };

// ---------------------------------------------------------------- bills lifecycle (evaluated lazily)
export function advanceBills() {
  const t = now();
  const quorum = Math.max(1, Math.ceil(q.get("SELECT COUNT(*) c FROM users WHERE status = 'citizen'").c * 0.1));
  for (const b of q.all("SELECT * FROM bills WHERE status = 'voting' AND voting_ends <= ?", t)) {
    const turnout = b.yes + b.no + b.abstain;
    const passed = turnout >= quorum && b.yes > b.no;
    q.run('UPDATE bills SET status = ? WHERE id = ?', passed ? 'passed' : 'failed', b.id);
    gazette('legislation', `Bill #${b.id} “${b.title}” ${passed ? 'passed' : 'failed'} the national vote`,
      `Yes ${b.yes} · No ${b.no} · Abstain ${b.abstain}. Turnout ${turnout} (quorum ${quorum}).${passed ? ' Awaiting assent from the Head of State.' : ''}`, `bill:${b.id}`);
  }
}

// ---------------------------------------------------------------- overview
r.get('/overview', (req, res) => {
  advanceBills();
  res.json({
    stats: {
      citizens: q.get("SELECT COUNT(*) c FROM users WHERE status = 'citizen'").c,
      applicationsPending: q.get("SELECT COUNT(*) c FROM applications WHERE status = 'pending'").c,
      lawsInForce: q.get("SELECT COUNT(*) c FROM laws WHERE status = 'in_force'").c,
      billsVoting: q.get("SELECT COUNT(*) c FROM bills WHERE status = 'voting'").c,
      listings: q.get("SELECT COUNT(*) c FROM listings WHERE status = 'active'").c,
      forumThreads: q.get('SELECT COUNT(*) c FROM forum_threads WHERE deleted = 0').c,
      supply: supplyStats().total,
    },
    news: q.all('SELECT id, title, summary, category, published_at, pinned FROM news ORDER BY pinned DESC, published_at DESC LIMIT 5'),
    bills: q.all("SELECT id, title, summary, status, voting_ends, yes, no, abstain FROM bills WHERE status IN ('voting','gathering') ORDER BY status = 'voting' DESC, created_at DESC LIMIT 4"),
    gazette: q.all('SELECT * FROM gazette ORDER BY id DESC LIMIT 6'),
    departments: q.all('SELECT id, slug, name, short, branch, icon FROM departments ORDER BY sort'),
  });
});

// ---------------------------------------------------------------- news
const NEWS_CATEGORIES = ['announcement', 'policy', 'economy', 'security', 'community', 'legislation'];
r.get('/news', (req, res) => {
  const { limit, offset, page: p } = page(req, 12);
  const cat = NEWS_CATEGORIES.includes(req.query.category) ? req.query.category : null;
  const where = cat ? 'WHERE category = ?' : '';
  const args = cat ? [cat] : [];
  const items = q.all(`SELECT n.id, n.title, n.summary, n.category, n.published_at, n.pinned, d.name dept FROM news n LEFT JOIN departments d ON d.id = n.department_id ${where} ORDER BY pinned DESC, published_at DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
  const total = q.get(`SELECT COUNT(*) c FROM news ${where}`, ...args).c;
  res.json({ items, total, page: p, pages: Math.ceil(total / limit), categories: NEWS_CATEGORIES });
});
r.get('/news/:id', (req, res) => {
  const n = q.get('SELECT * FROM news WHERE id = ?', Number(req.params.id));
  if (!n) throw notFound('Article not found');
  res.json({ ...n, author: userBrief(n.author_id), department: q.get('SELECT slug, name FROM departments WHERE id = ?', n.department_id) || null });
});
r.post('/news', requireOfficial, h(async (req, res) => {
  const title = str(req.body.title, 'Title', { min: 5, max: 160 });
  const summary = str(req.body.summary, 'Summary', { min: 10, max: 400 });
  const body = str(req.body.body, 'Body', { min: 20, max: 20000 });
  const category = oneOf(req.body.category, 'Category', NEWS_CATEGORIES);
  const deptId = isAdmin(req.user) && req.body.departmentId ? Number(req.body.departmentId) : req.user.department_id;
  const info = q.run('INSERT INTO news (title, summary, body, category, department_id, author_id, published_at, pinned) VALUES (?,?,?,?,?,?,?,?)',
    title, summary, body, category, deptId, req.user.id, now(), !!req.body.pinned && isAdmin(req.user));
  audit(req.user.id, 'news_published', { id: Number(info.lastInsertRowid) });
  res.json({ id: Number(info.lastInsertRowid) });
}));
r.delete('/news/:id', requireOfficial, (req, res) => {
  const n = q.get('SELECT * FROM news WHERE id = ?', Number(req.params.id));
  if (!n) throw notFound();
  if (!isAdmin(req.user) && n.author_id !== req.user.id) throw forbidden('You can only retract your own articles');
  q.run('DELETE FROM news WHERE id = ?', n.id);
  audit(req.user.id, 'news_retracted', { id: n.id, title: n.title });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- departments
r.get('/departments', (_req, res) => {
  res.json(q.all(`SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role IN ('official','admin')) staff FROM departments d ORDER BY sort`).map(parseDept));
});
r.get('/departments/:slug', (req, res) => {
  const d = parseDept(q.get('SELECT * FROM departments WHERE slug = ?', req.params.slug));
  if (!d) throw notFound('Department not found');
  res.json({
    ...d,
    staff: q.all("SELECT id, username, display_name, official_title, role FROM users WHERE department_id = ? AND role IN ('official','admin') ORDER BY role = 'admin' DESC, id").map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, officialTitle: u.official_title })),
    news: q.all('SELECT id, title, summary, published_at FROM news WHERE department_id = ? ORDER BY published_at DESC LIMIT 5', d.id),
    laws: q.all('SELECT id, code, title FROM laws WHERE department_id = ? ORDER BY enacted_at', d.id),
    requests: q.get("SELECT COUNT(*) total, SUM(status = 'open') open FROM records_requests WHERE department_id = ?", d.id),
  });
});

// ---------------------------------------------------------------- laws
r.get('/laws', (req, res) => {
  const kind = ['constitution', 'act', 'regulation', 'order'].includes(req.query.kind) ? req.query.kind : null;
  const term = String(req.query.q || '').trim();
  const conds = []; const args = [];
  if (kind) { conds.push('kind = ?'); args.push(kind); }
  if (term) { conds.push('(title LIKE ? OR body LIKE ? OR code LIKE ?)'); args.push(`%${term}%`, `%${term}%`, `%${term}%`); }
  res.json(q.all(`SELECT id, code, title, kind, summary, status, enacted_at, bill_id FROM laws ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY kind = 'constitution' DESC, enacted_at, id`, ...args));
});
r.get('/laws/:id', (req, res) => {
  const l = q.get('SELECT * FROM laws WHERE id = ?', Number(req.params.id));
  if (!l) throw notFound('Law not found');
  res.json({ ...l, department: q.get('SELECT slug, name FROM departments WHERE id = ?', l.department_id) || null });
});

// ---------------------------------------------------------------- bills (citizen legislation)
r.get('/bills', (req, res) => {
  advanceBills();
  const status = String(req.query.status || '');
  const rows = q.all(`SELECT b.*, (SELECT COUNT(*) FROM bill_signatures s WHERE s.bill_id = b.id) signatures FROM bills b
    ${status ? 'WHERE status = ?' : ''} ORDER BY CASE status WHEN 'voting' THEN 0 WHEN 'gathering' THEN 1 WHEN 'passed' THEN 2 ELSE 3 END, created_at DESC`, ...(status ? [status] : []));
  res.json({ items: rows.map((b) => ({ ...b, body: undefined, sponsor: userBrief(b.sponsor_id) })), threshold: SECURITY.billSignatureThreshold });
});
r.get('/bills/:id', (req, res) => {
  advanceBills();
  const b = q.get('SELECT * FROM bills WHERE id = ?', Number(req.params.id));
  if (!b) throw notFound('Bill not found');
  const uid = req.user?.id;
  res.json({
    ...b, sponsor: userBrief(b.sponsor_id), threshold: SECURITY.billSignatureThreshold,
    signatures: q.get('SELECT COUNT(*) c FROM bill_signatures WHERE bill_id = ?', b.id).c,
    signed: !!(uid && q.get('SELECT 1 FROM bill_signatures WHERE bill_id = ? AND user_id = ?', b.id, uid)),
    myVote: uid ? q.get('SELECT choice, ts FROM bill_votes WHERE bill_id = ? AND user_id = ?', b.id, uid) || null : null,
    department: q.get('SELECT slug, name FROM departments WHERE id = ?', b.department_id) || null,
  });
});
r.post('/bills', requirePassport, h(async (req, res) => {
  const title = str(req.body.title, 'Title', { min: 8, max: 160 });
  const summary = str(req.body.summary, 'Summary', { min: 20, max: 600 });
  const body = str(req.body.body, 'Text of the bill', { min: 50, max: 30000 });
  const deptId = req.body.departmentId ? Number(req.body.departmentId) : null;
  if (q.get("SELECT COUNT(*) c FROM bills WHERE sponsor_id = ? AND status = 'gathering'", req.user.id).c >= 3) throw bad('You already have 3 bills gathering signatures');
  const info = q.run('INSERT INTO bills (title, summary, body, sponsor_id, department_id, created_at) VALUES (?,?,?,?,?,?)', title, summary, body, req.user.id, deptId, now());
  const id = Number(info.lastInsertRowid);
  q.run('INSERT INTO bill_signatures (bill_id, user_id, ts) VALUES (?,?,?)', id, req.user.id, now());
  maybeOpenVoting(id);
  res.json({ id });
}));
function maybeOpenVoting(billId) {
  const b = q.get('SELECT * FROM bills WHERE id = ?', billId);
  const n = q.get('SELECT COUNT(*) c FROM bill_signatures WHERE bill_id = ?', billId).c;
  if (b.status === 'gathering' && n >= SECURITY.billSignatureThreshold) {
    q.run("UPDATE bills SET status = 'voting', voting_starts = ?, voting_ends = ? WHERE id = ?", now(), now() + SECURITY.billVotingDays * 864e5, billId);
    gazette('legislation', `Bill #${billId} “${b.title}” opened for a national vote`, `Voting closes in ${SECURITY.billVotingDays} days.`, `bill:${billId}`);
  }
}
r.post('/bills/:id/sign', requirePassport, (req, res) => {
  const b = q.get('SELECT * FROM bills WHERE id = ?', Number(req.params.id));
  if (!b) throw notFound();
  if (b.status !== 'gathering') throw bad('This bill is no longer gathering signatures');
  q.run('INSERT OR IGNORE INTO bill_signatures (bill_id, user_id, ts) VALUES (?,?,?)', b.id, req.user.id, now());
  maybeOpenVoting(b.id);
  res.json({ ok: true });
});
r.post('/bills/:id/vote', requireAccess('bill.vote', (req) => req.body.params), h(async (req, res) => {
  const { billId, choice } = req.access.params;
  if (Number(billId) !== Number(req.params.id)) throw bad('Bill mismatch');
  oneOf(choice, 'Vote', ['yes', 'no', 'abstain']);
  advanceBills();
  tx(() => {
    const b = q.get('SELECT * FROM bills WHERE id = ?', Number(billId));
    if (!b || b.status !== 'voting') throw bad('Voting is not open on this bill');
    if (q.get('SELECT 1 FROM bill_votes WHERE bill_id = ? AND user_id = ?', b.id, req.user.id)) throw bad('You have already voted on this bill');
    q.run('INSERT INTO bill_votes (bill_id, user_id, choice, ts, challenge, sig) VALUES (?,?,?,?,?,?)', b.id, req.user.id, choice, now(), req.access.challenge, req.access.signature);
    q.run(`UPDATE bills SET ${choice} = ${choice} + 1 WHERE id = ?`, b.id);
  });
  res.json({ ok: true });
}));
r.post('/bills/:id/withdraw', requireCitizen, (req, res) => {
  const b = q.get('SELECT * FROM bills WHERE id = ?', Number(req.params.id));
  if (!b || b.sponsor_id !== req.user.id) throw forbidden('Only the sponsor can withdraw a bill');
  if (b.status !== 'gathering') throw bad('Bills can only be withdrawn before voting opens');
  q.run("UPDATE bills SET status = 'withdrawn' WHERE id = ?", b.id);
  res.json({ ok: true });
});
r.post('/bills/:id/assent', requireAdmin, (req, res) => {
  const b = q.get('SELECT * FROM bills WHERE id = ?', Number(req.params.id));
  if (!b || b.status !== 'passed') throw bad('Only bills that passed the national vote can receive assent');
  const decision = oneOf(req.body.decision, 'Decision', ['assent', 'veto']);
  tx(() => {
    if (decision === 'veto') {
      q.run("UPDATE bills SET status = 'vetoed' WHERE id = ?", b.id);
      gazette('legislation', `Bill #${b.id} vetoed by the Head of State`, String(req.body.reason || ''), `bill:${b.id}`);
      return;
    }
    const year = new Date().getUTCFullYear();
    const seq = q.get("SELECT COUNT(*) c FROM laws WHERE kind = 'act' AND code LIKE ?", `Act ${year}-%`).c + 1;
    const code = `Act ${year}-${String(seq).padStart(2, '0')}`;
    const info = q.run('INSERT INTO laws (code, title, kind, summary, body, enacted_at, bill_id, department_id) VALUES (?,?,?,?,?,?,?,?)', code, b.title, 'act', b.summary, b.body, now(), b.id, b.department_id);
    q.run("UPDATE bills SET status = 'enacted', law_id = ? WHERE id = ?", info.lastInsertRowid, b.id);
    gazette('legislation', `${code} “${b.title}” enacted`, `Royal/Presidential assent given. The Act is now in force.`, `law:${info.lastInsertRowid}`);
  });
  audit(req.user.id, `bill_${decision}`, { bill: b.id });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- public records
r.get('/records/registry', (req, res) => {
  const { limit, offset, page: p } = page(req, 30);
  const term = String(req.query.q || '').trim();
  const where = "WHERE status = 'citizen'" + (term ? ' AND (username LIKE ? OR display_name LIKE ? OR passport_no LIKE ?)' : '');
  const args = term ? [`%${term}%`, `%${term}%`, `%${term}%`] : [];
  const items = q.all(`SELECT id, username, display_name, role, official_title, passport_no, citizen_since, key_id FROM users ${where} ORDER BY citizen_since LIMIT ? OFFSET ?`, ...args, limit, offset)
    .map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, officialTitle: u.official_title, passportNo: u.passport_no, citizenSince: u.citizen_since, keyId: u.key_id }));
  const total = q.get(`SELECT COUNT(*) c FROM users ${where}`, ...args).c;
  res.json({ items, total, page: p, pages: Math.ceil(total / limit) });
});

r.get('/records/ledger', (req, res) => {
  const { limit, offset, page: p } = page(req, 25);
  const uid = req.query.user ? Number(req.query.user) : null;
  const where = uid ? 'WHERE from_id = ? OR to_id = ?' : '';
  const args = uid ? [uid, uid] : [];
  const names = new Map();
  const nm = (id) => { if (id == null) return null; if (!names.has(id)) names.set(id, q.get('SELECT username FROM users WHERE id = ?', id)?.username || `#${id}`); return names.get(id); };
  const items = q.all(`SELECT id, ts, type, from_id, to_id, amount, serials, memo, ref, hash, prev_hash, sender_sig IS NOT NULL signed FROM ledger ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...args, limit, offset)
    .map((t) => ({ ...t, from: nm(t.from_id), to: nm(t.to_id), signed: !!t.signed }));
  const total = q.get(`SELECT COUNT(*) c FROM ledger ${where}`, ...args).c;
  res.json({ items, total, page: p, pages: Math.ceil(total / limit) });
});
r.get('/records/ledger/verify', (_req, res) => res.json(verifyChain()));
r.get('/records/ledger/:id', (req, res) => {
  const t = q.get('SELECT * FROM ledger WHERE id = ?', Number(req.params.id));
  if (!t) throw notFound();
  const serialList = expand(t.serials);
  res.json({ ...t, serialCount: serialList.length, preview: serialList.slice(0, 24).map((s) => ({ serial: s, rarity: rarityFor(s).id })), from: userBrief(t.from_id), to: userBrief(t.to_id), fromKey: t.from_id ? q.get('SELECT public_key FROM users WHERE id = ?', t.from_id)?.public_key : null });
});

r.get('/records/gazette', (req, res) => {
  const { limit, offset, page: p } = page(req, 30);
  const kind = String(req.query.kind || '');
  const where = kind ? 'WHERE kind = ?' : '';
  const args = kind ? [kind] : [];
  res.json({ items: q.all(`SELECT * FROM gazette ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...args, limit, offset), page: p, pages: Math.ceil(q.get(`SELECT COUNT(*) c FROM gazette ${where}`, ...args).c / limit) });
});
r.post('/records/gazette', requireOfficial, (req, res) => {
  gazette('notice', str(req.body.title, 'Title', { min: 5, max: 200 }), str(req.body.body, 'Body', { max: 4000, optional: true }), `user:${req.user.id}`);
  res.json({ ok: true });
});

r.get('/records/treasury', (_req, res) => {
  const s = supplyStats();
  const top = q.all(`SELECT u.username, u.display_name, COUNT(*) c FROM tokens t JOIN users u ON u.id = t.owner_id GROUP BY t.owner_id ORDER BY c DESC LIMIT 10`);
  const legendary = q.all(`SELECT t.serial, u.username FROM tokens t JOIN users u ON u.id = t.owner_id WHERE t.rarity = 'legendary' ORDER BY t.serial LIMIT 50`);
  const daily = q.all(`SELECT (ts / 86400000) d, COUNT(*) c, SUM(amount) v FROM ledger WHERE type IN ('transfer','escrow') AND ts > ? GROUP BY d ORDER BY d`, now() - 30 * 864e5)
    .map((r2) => ({ day: r2.d * 864e5, count: r2.c, volume: r2.v }));
  res.json({ ...s, currency: NATION.currency, grant: NATION.citizenshipGrant, top, legendary, daily });
});

r.get('/records/requests', (req, res) => {
  const { limit, offset, page: p } = page(req, 20);
  const items = q.all(`SELECT r.*, d.name dept FROM records_requests r LEFT JOIN departments d ON d.id = r.department_id ORDER BY r.id DESC LIMIT ? OFFSET ?`, limit, offset)
    .map((x) => ({ ...x, requester: userBrief(x.user_id), responder: userBrief(x.responder_id) }));
  res.json({ items, page: p, pages: Math.ceil(q.get('SELECT COUNT(*) c FROM records_requests').c / limit) });
});
r.post('/records/requests', requirePassport, (req, res) => {
  const subject = str(req.body.subject, 'Subject', { min: 5, max: 160 });
  const details = str(req.body.details, 'Details', { min: 20, max: 4000 });
  const dept = req.body.departmentId ? q.get('SELECT id FROM departments WHERE id = ?', Number(req.body.departmentId)) : null;
  const info = q.run('INSERT INTO records_requests (user_id, department_id, subject, details, created_at) VALUES (?,?,?,?,?)', req.user.id, dept?.id, subject, details, now());
  res.json({ id: Number(info.lastInsertRowid) });
});
r.post('/records/requests/:id/respond', requireOfficial, (req, res) => {
  const x = q.get('SELECT * FROM records_requests WHERE id = ?', Number(req.params.id));
  if (!x) throw notFound();
  if (!isAdmin(req.user) && x.department_id && x.department_id !== req.user.department_id) throw forbidden('This request is addressed to another department');
  const status = oneOf(req.body.status, 'Status', ['fulfilled', 'denied']);
  q.run('UPDATE records_requests SET status = ?, response = ?, responder_id = ?, responded_at = ? WHERE id = ?', status, str(req.body.response, 'Response', { min: 5, max: 8000 }), req.user.id, now(), x.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- passport verification + citizen profiles
r.get('/verify/:pn', (req, res) => {
  const u = q.get('SELECT * FROM users WHERE passport_no = ?', String(req.params.pn).toUpperCase());
  if (!u) return res.json({ valid: false, reason: 'No passport with this number has been issued' });
  let tokenCheck = null;
  if (req.query.token) {
    const p = readPassportToken(req.query.token);
    tokenCheck = !p ? 'forged' : p.pn !== u.passport_no ? 'mismatch' : p.v !== u.passport_version ? 'superseded' : 'authentic';
  }
  res.json({
    valid: u.status === 'citizen', status: u.status, passportNo: u.passport_no, username: u.username, displayName: u.display_name,
    issuedAt: u.passport_issued_at, version: u.passport_version, keyId: u.key_id, tokenCheck,
  });
});

r.get('/citizens/:username', (req, res) => {
  const u = q.get('SELECT * FROM users WHERE username = ?', req.params.username);
  if (!u || !['citizen', 'suspended'].includes(u.status)) throw notFound('Citizen not found');
  const dept = u.department_id ? q.get('SELECT slug, name FROM departments WHERE id = ?', u.department_id) : null;
  res.json({
    ...publicUser(u), department: dept, keyId: u.key_id,
    stats: {
      posts: q.get('SELECT COUNT(*) c FROM forum_posts WHERE user_id = ? AND deleted = 0', u.id).c,
      listings: q.get("SELECT COUNT(*) c FROM listings WHERE seller_id = ? AND status = 'active'", u.id).c,
      sales: q.get("SELECT COUNT(*) c FROM orders WHERE seller_id = ? AND status = 'completed'", u.id).c,
      rating: q.get("SELECT AVG(rating) a, COUNT(rating) n FROM orders WHERE seller_id = ? AND rating IS NOT NULL", u.id),
      bills: q.get('SELECT COUNT(*) c FROM bills WHERE sponsor_id = ?', u.id).c,
    },
    threads: q.all('SELECT id, title, created_at FROM forum_threads WHERE user_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 5', u.id),
  });
});

export default r;
