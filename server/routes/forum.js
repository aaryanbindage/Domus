import { Router } from 'express';
import { q, tx, now, audit } from '../db.js';
import { requireCitizen, requireAuth, isOfficial } from '../auth.js';
import { str, int, bad, forbidden, notFound, oneOf, page, rateLimit } from '../util.js';

const r = Router();
const author = (u) => ({ id: u.user_id, username: u.username, displayName: u.display_name, role: u.role, officialTitle: u.official_title });

r.get('/categories', (_req, res) => {
  res.json(q.all(`SELECT c.*,
      (SELECT COUNT(*) FROM forum_threads t WHERE t.category_id = c.id AND t.deleted = 0) threads,
      (SELECT COALESCE(SUM(post_count),0) FROM forum_threads t WHERE t.category_id = c.id AND t.deleted = 0) posts,
      (SELECT json_object('id', t.id, 'title', t.title, 'at', t.last_post_at) FROM forum_threads t WHERE t.category_id = c.id AND t.deleted = 0 ORDER BY t.last_post_at DESC LIMIT 1) latest
    FROM forum_categories c ORDER BY sort`).map((c) => ({ ...c, latest: c.latest ? JSON.parse(c.latest) : null })));
});

r.get('/categories/:slug', (req, res) => {
  const c = q.get('SELECT * FROM forum_categories WHERE slug = ?', req.params.slug);
  if (!c) throw notFound('Category not found');
  const { limit, offset, page: p } = page(req, 25);
  const threads = q.all(`SELECT t.*, u.username, u.display_name, u.role, u.official_title FROM forum_threads t JOIN users u ON u.id = t.user_id
    WHERE t.category_id = ? AND t.deleted = 0 ORDER BY t.pinned DESC, t.last_post_at DESC LIMIT ? OFFSET ?`, c.id, limit, offset)
    .map((t) => ({ id: t.id, title: t.title, created_at: t.created_at, last_post_at: t.last_post_at, post_count: t.post_count, pinned: !!t.pinned, locked: !!t.locked, author: author(t) }));
  const total = q.get('SELECT COUNT(*) c FROM forum_threads WHERE category_id = ? AND deleted = 0', c.id).c;
  res.json({ category: c, threads, page: p, pages: Math.ceil(total / limit) });
});

r.get('/recent', (_req, res) => {
  res.json(q.all(`SELECT t.id, t.title, t.post_count, t.last_post_at, c.name category, c.slug FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
    WHERE t.deleted = 0 ORDER BY t.last_post_at DESC LIMIT 8`));
});

r.get('/threads/:id', (req, res) => {
  const t = q.get('SELECT t.*, c.slug, c.name category FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id WHERE t.id = ?', Number(req.params.id));
  if (!t || (t.deleted && !isOfficial(req.user))) throw notFound('Thread not found');
  const { limit, offset, page: p } = page(req, 30);
  const uid = req.user?.id || 0;
  const posts = q.all(`SELECT p.*, u.username, u.display_name, u.role, u.official_title, u.citizen_since,
      (SELECT COUNT(*) FROM forum_likes l WHERE l.post_id = p.id) likes,
      EXISTS(SELECT 1 FROM forum_likes l WHERE l.post_id = p.id AND l.user_id = ?) liked
    FROM forum_posts p JOIN users u ON u.id = p.user_id WHERE p.thread_id = ? ORDER BY p.id LIMIT ? OFFSET ?`, uid, t.id, limit, offset)
    .map((x) => ({ id: x.id, body: x.deleted ? '' : x.body, deleted: !!x.deleted, created_at: x.created_at, edited_at: x.edited_at, likes: x.likes, liked: !!x.liked, author: { ...author(x), citizenSince: x.citizen_since }, mine: x.user_id === uid }));
  res.json({ thread: { id: t.id, title: t.title, category: t.category, slug: t.slug, pinned: !!t.pinned, locked: !!t.locked, deleted: !!t.deleted, created_at: t.created_at }, posts, page: p, pages: Math.ceil(t.post_count / limit) });
});

r.post('/threads', requireCitizen, (req, res) => {
  rateLimit(`thread:${req.user.id}`, 5, 10 * 60e3);
  const c = q.get('SELECT * FROM forum_categories WHERE id = ?', Number(req.body.categoryId));
  if (!c) throw bad('Choose a category');
  if (c.official_only && !isOfficial(req.user)) throw forbidden('Only government officials can start threads here');
  const title = str(req.body.title, 'Title', { min: 5, max: 140 });
  const body = str(req.body.body, 'Post', { min: 2, max: 10000 });
  const id = tx(() => {
    const t = q.run('INSERT INTO forum_threads (category_id, user_id, title, created_at, last_post_at, post_count) VALUES (?,?,?,?,?,1)', c.id, req.user.id, title, now(), now());
    q.run('INSERT INTO forum_posts (thread_id, user_id, body, created_at) VALUES (?,?,?,?)', t.lastInsertRowid, req.user.id, body, now());
    return Number(t.lastInsertRowid);
  });
  res.json({ id });
});

r.post('/threads/:id/posts', requireCitizen, (req, res) => {
  rateLimit(`post:${req.user.id}`, 20, 10 * 60e3);
  const t = q.get('SELECT * FROM forum_threads WHERE id = ? AND deleted = 0', Number(req.params.id));
  if (!t) throw notFound('Thread not found');
  if (t.locked && !isOfficial(req.user)) throw forbidden('This thread is locked');
  const body = str(req.body.body, 'Reply', { min: 2, max: 10000 });
  tx(() => {
    q.run('INSERT INTO forum_posts (thread_id, user_id, body, created_at) VALUES (?,?,?,?)', t.id, req.user.id, body, now());
    q.run('UPDATE forum_threads SET post_count = post_count + 1, last_post_at = ? WHERE id = ?', now(), t.id);
  });
  res.json({ ok: true, pages: Math.ceil((t.post_count + 1) / 30) });
});

r.patch('/posts/:id', requireCitizen, (req, res) => {
  const p = q.get('SELECT * FROM forum_posts WHERE id = ? AND deleted = 0', Number(req.params.id));
  if (!p || p.user_id !== req.user.id) throw forbidden('You can only edit your own posts');
  q.run('UPDATE forum_posts SET body = ?, edited_at = ? WHERE id = ?', str(req.body.body, 'Post', { min: 2, max: 10000 }), now(), p.id);
  res.json({ ok: true });
});

r.delete('/posts/:id', requireCitizen, (req, res) => {
  const p = q.get('SELECT * FROM forum_posts WHERE id = ?', Number(req.params.id));
  if (!p) throw notFound();
  if (p.user_id !== req.user.id && !isOfficial(req.user)) throw forbidden('Not your post');
  q.run('UPDATE forum_posts SET deleted = 1 WHERE id = ?', p.id);
  if (p.user_id !== req.user.id) audit(req.user.id, 'post_removed', { post: p.id });
  res.json({ ok: true });
});

r.post('/posts/:id/like', requireCitizen, (req, res) => {
  const id = Number(req.params.id);
  if (!q.get('SELECT 1 FROM forum_posts WHERE id = ? AND deleted = 0', id)) throw notFound();
  if (q.get('SELECT 1 FROM forum_likes WHERE post_id = ? AND user_id = ?', id, req.user.id)) q.run('DELETE FROM forum_likes WHERE post_id = ? AND user_id = ?', id, req.user.id);
  else q.run('INSERT INTO forum_likes (post_id, user_id) VALUES (?,?)', id, req.user.id);
  res.json({ ok: true });
});

r.post('/threads/:id/moderate', requireCitizen, (req, res) => {
  if (!isOfficial(req.user)) throw forbidden('Moderators only');
  const t = q.get('SELECT * FROM forum_threads WHERE id = ?', Number(req.params.id));
  if (!t) throw notFound();
  const f = (k) => (req.body[k] == null ? t[k] : req.body[k] ? 1 : 0);
  q.run('UPDATE forum_threads SET pinned = ?, locked = ?, deleted = ? WHERE id = ?', f('pinned'), f('locked'), f('deleted'), t.id);
  audit(req.user.id, 'thread_moderated', { thread: t.id, ...req.body });
  res.json({ ok: true });
});

r.post('/report', requireAuth, (req, res) => {
  rateLimit(`report:${req.user.id}`, 10, 60 * 60e3);
  const kind = oneOf(req.body.kind, 'Kind', ['post', 'thread', 'listing', 'user']);
  q.run('INSERT INTO reports (kind, target_id, user_id, reason, created_at) VALUES (?,?,?,?,?)', kind, int(req.body.targetId, 'Target'), req.user.id, str(req.body.reason, 'Reason', { min: 5, max: 1000 }), now());
  res.json({ ok: true });
});

export default r;
