import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { q, tx, now, audit, gazette } from '../db.js';
import { PRIVATE_DIR } from '../config.js';
import { requireOfficial, requirePassport, requireAccess, isAdmin } from '../auth.js';
import { h, str, bad, forbidden, notFound, oneOf, page } from '../util.js';
import { setCitizenActive } from '../ledger.js';

const r = Router();
r.use(requireOfficial);

const citizenshipDept = () => q.get("SELECT id FROM departments WHERE slug = 'citizenship'")?.id;
const canReview = (u) => isAdmin(u) || u.department_id === citizenshipDept();
function reviewerOnly(req, _res, next) { next(canReview(req.user) ? undefined : forbidden('Only the Department of Citizenship reviews applications')); }

r.get('/stats', (req, res) => {
  const statuses = Object.fromEntries(q.all('SELECT status, COUNT(*) c FROM users GROUP BY status').map((x) => [x.status, x.c]));
  res.json({
    statuses,
    pendingApplications: q.get("SELECT COUNT(*) c FROM applications WHERE status = 'pending'").c,
    openReports: q.get('SELECT COUNT(*) c FROM reports WHERE resolved_at IS NULL').c,
    disputes: q.get("SELECT COUNT(*) c FROM orders WHERE status = 'disputed'").c,
    keyRequests: q.get("SELECT COUNT(*) c FROM users WHERE key_reissue = 'requested'").c,
    openRecordRequests: q.get("SELECT COUNT(*) c FROM records_requests WHERE status = 'open'").c,
    passedBills: q.get("SELECT COUNT(*) c FROM bills WHERE status = 'passed'").c,
    canReview: canReview(req.user), isAdmin: isAdmin(req.user),
    audit: isAdmin(req.user) ? q.all('SELECT a.*, u.username FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 40') : [],
  });
});

// ---------------------------------------------------------------- citizenship applications
r.get('/applications', reviewerOnly, (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'banned'].includes(req.query.status) ? req.query.status : 'pending';
  res.json(q.all(`SELECT a.id, a.user_id, a.legal_name, a.country, a.doc_type, a.status, a.flags, a.created_at, a.live_capture, u.username, u.email
    FROM applications a JOIN users u ON u.id = a.user_id WHERE a.status = ? ORDER BY a.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 200`, status)
    .map((a) => ({ ...a, flags: JSON.parse(a.flags) })));
});
r.get('/applications/:id', reviewerOnly, (req, res) => {
  const a = q.get('SELECT a.*, u.username, u.email, u.display_name, u.created_at user_created FROM applications a JOIN users u ON u.id = a.user_id WHERE a.id = ?', Number(req.params.id));
  if (!a) throw notFound();
  const history = q.all('SELECT id, status, review_note, created_at FROM applications WHERE user_id = ? AND id != ? ORDER BY id DESC', a.user_id, a.id);
  res.json({ ...a, flags: JSON.parse(a.flags), guardian_token: undefined, doc_hmac: undefined, person_hmac: undefined, ip_hmac: undefined, history, reviewer: a.reviewer_id ? q.get('SELECT username FROM users WHERE id = ?', a.reviewer_id)?.username : null });
});
r.get('/applications/:id/:which(document|selfie)', reviewerOnly, (req, res) => {
  const a = q.get('SELECT doc_image, selfie_image FROM applications WHERE id = ?', Number(req.params.id));
  if (!a) throw notFound();
  const file = path.join(PRIVATE_DIR, path.basename(req.params.which === 'document' ? a.doc_image : a.selfie_image));
  if (!fs.existsSync(file)) throw notFound();
  res.setHeader('Cache-Control', 'private, no-store');
  audit(req.user.id, 'identity_document_viewed', { application: a.id, which: req.params.which });
  res.sendFile(file);
});
r.post('/applications/:id/decide', reviewerOnly, requirePassport, (req, res) => {
  const a = q.get('SELECT * FROM applications WHERE id = ?', Number(req.params.id));
  if (!a || a.status !== 'pending') throw bad('Application is not pending');
  if (a.user_id === req.user.id) throw forbidden('You cannot review your own application');
  const decision = oneOf(req.body.decision, 'Decision', ['approve', 'reject', 'ban']);
  const note = str(req.body.note, 'Note to applicant', { max: 1000, optional: true });
  if (decision !== 'approve' && note.length < 5) throw bad('Explain the decision to the applicant');
  if (decision === 'approve' && a.guardian_email && !a.guardian_consent_at) throw bad('This applicant is under 13: wait until their parent or guardian has consented by email');
  tx(() => {
    const appStatus = { approve: 'approved', reject: 'rejected', ban: 'banned' }[decision];
    q.run('UPDATE applications SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ? WHERE id = ?', appStatus, req.user.id, note, now(), a.id);
    // Approved applicants keep their selfie as the passport photo.
    if (decision === 'approve') q.run("UPDATE users SET status = 'approved', photo_path = ? WHERE id = ?", a.selfie_image, a.user_id);
    else q.run('UPDATE users SET status = ? WHERE id = ?', appStatus, a.user_id);
  });
  audit(req.user.id, `application_${decision}`, { application: a.id, user: a.user_id });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- users
r.get('/users', (req, res) => {
  const { limit, offset } = page(req, 50);
  const term = String(req.query.q || '').trim();
  const where = term ? 'WHERE username LIKE ? OR display_name LIKE ? OR email LIKE ? OR passport_no LIKE ?' : '';
  const args = term ? Array(4).fill(`%${term}%`) : [];
  res.json(q.all(`SELECT id, username, display_name, email, role, status, department_id, official_title, passport_no, key_reissue, created_at, citizen_since FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...args, limit, offset)
    .map((u) => (isAdmin(req.user) ? u : { ...u, email: undefined })));
});

// params: { userId, role, departmentId, title }
r.post('/users/role', requireAccess('admin.role', (req) => req.body.params), (req, res) => {
  if (!isAdmin(req.user)) throw forbidden('Only the Head of State appoints officials');
  const { userId, role, departmentId, title } = req.access.params;
  oneOf(role, 'Role', ['member', 'official', 'admin']);
  const u = q.get('SELECT * FROM users WHERE id = ?', Number(userId));
  if (!u || u.status !== 'citizen') throw bad('Only citizens can hold office');
  if (u.id === req.user.id && role !== 'admin') throw bad('You cannot demote yourself');
  const dept = departmentId ? q.get('SELECT id, name FROM departments WHERE id = ?', Number(departmentId)) : null;
  const t = role === 'member' ? null : str(title, 'Title', { min: 3, max: 80 });
  q.run('UPDATE users SET role = ?, department_id = ?, official_title = ? WHERE id = ?', role, role === 'member' ? null : dept?.id, t, u.id);
  gazette('appointment', role === 'member' ? `@${u.username} has left public office` : `@${u.username} appointed ${t}${dept ? `, ${dept.name}` : ''}`, '', `user:${u.id}`);
  audit(req.user.id, 'role_changed', { user: u.id, role, dept: dept?.id });
  res.json({ ok: true });
});

// params: { userId, status }
r.post('/users/status', requireAccess('admin.status', (req) => req.body.params), h(async (req, res) => {
  if (!isAdmin(req.user)) throw forbidden('Head of State only');
  const { userId, status } = req.access.params;
  oneOf(status, 'Status', ['citizen', 'suspended']);
  const u = q.get('SELECT * FROM users WHERE id = ?', Number(userId));
  if (!u || !['citizen', 'suspended'].includes(u.status)) throw bad('Only citizens can be suspended or reinstated');
  if (u.id === req.user.id) throw bad('You cannot suspend yourself');
  if (u.chain_address) await setCitizenActive(u.id, status === 'citizen');
  q.run('UPDATE users SET status = ? WHERE id = ?', status, u.id);
  if (status === 'suspended') q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  gazette('notice', `Citizenship of @${u.username} ${status === 'suspended' ? 'suspended' : 'reinstated'}`, '', `user:${u.id}`);
  audit(req.user.id, `user_${status}`, { user: u.id });
  res.json({ ok: true });
}));

r.post('/users/:id/allow-reissue', reviewerOnly, requirePassport, (req, res) => {
  const u = q.get("SELECT * FROM users WHERE id = ? AND key_reissue = 'requested'", Number(req.params.id));
  if (!u) throw bad('No pending key reissue request for this citizen');
  q.run("UPDATE users SET key_reissue = ? WHERE id = ?", req.body.deny ? 'none' : 'allowed', u.id);
  audit(req.user.id, req.body.deny ? 'key_reissue_denied' : 'key_reissue_allowed', { user: u.id });
  res.json({ ok: true });
});
r.get('/key-requests', reviewerOnly, (_req, res) => {
  res.json(q.all("SELECT id, username, display_name, passport_no, legal_name FROM users WHERE key_reissue = 'requested'"));
});

// ---------------------------------------------------------------- reports
r.get('/reports', (_req, res) => {
  res.json(q.all('SELECT r.*, u.username reporter FROM reports r JOIN users u ON u.id = r.user_id WHERE resolved_at IS NULL ORDER BY r.id').map((x) => {
    let target = null;
    if (x.kind === 'post') target = q.get('SELECT p.body, p.thread_id, u.username FROM forum_posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?', x.target_id);
    if (x.kind === 'thread') target = q.get('SELECT t.title, u.username FROM forum_threads t JOIN users u ON u.id = t.user_id WHERE t.id = ?', x.target_id);
    if (x.kind === 'listing') target = q.get('SELECT l.title, u.username FROM listings l JOIN users u ON u.id = l.seller_id WHERE l.id = ?', x.target_id);
    if (x.kind === 'user') target = q.get('SELECT username FROM users WHERE id = ?', x.target_id);
    return { ...x, target };
  }));
});
r.post('/reports/:id/resolve', (req, res) => {
  const x = q.get('SELECT * FROM reports WHERE id = ? AND resolved_at IS NULL', Number(req.params.id));
  if (!x) throw notFound();
  const action = oneOf(req.body.action, 'Action', ['dismiss', 'remove']);
  tx(() => {
    if (action === 'remove') {
      if (x.kind === 'post') q.run('UPDATE forum_posts SET deleted = 1 WHERE id = ?', x.target_id);
      if (x.kind === 'thread') q.run('UPDATE forum_threads SET deleted = 1 WHERE id = ?', x.target_id);
      if (x.kind === 'listing') q.run("UPDATE listings SET status = 'removed' WHERE id = ?", x.target_id);
    }
    q.run('UPDATE reports SET resolved_by = ?, resolved_at = ?, resolution = ? WHERE kind = ? AND target_id = ? AND resolved_at IS NULL', req.user.id, now(), action, x.kind, x.target_id);
  });
  audit(req.user.id, 'report_resolved', { report: x.id, action });
  res.json({ ok: true });
});

export default r;
