// The National Council and the Applications Office. Every public office is a position with a
// number of seats; citizens apply for vacant seats and the right authority decides:
//   Head of State                    → the National Council, by majority vote
//   Council seats, heads of dept.    → the Head of State
//   deputies and officers            → the Head of State or the head of that department
// Decisions and votes are signed with the decider's .access key and published in the Gazette.
import { Router } from 'express';
import { q, tx, now, audit, gazette } from '../db.js';
import { requireAuth, requireCitizen, requirePassport, requireAccess, isAdmin } from '../auth.js';
import { h, str, bad, forbidden, notFound, oneOf } from '../util.js';

const r = Router();
const LEVELS = { head_of_state: 'Head of State', council: 'Council', head: 'Head of department', deputy: 'Deputy', staff: 'Officer' };

const position = (id) => q.get('SELECT p.*, d.slug dept_slug, d.name dept_name FROM positions p JOIN departments d ON d.id = p.department_id WHERE p.id = ?', Number(id));
const holders = (positionId) => q.all("SELECT id, username, display_name FROM users WHERE position_id = ? AND status = 'citizen' ORDER BY id", positionId);
const councilMembers = () => q.all(`SELECT u.id, u.username, u.display_name, p.title FROM users u JOIN positions p ON p.id = u.position_id
  JOIN departments d ON d.id = p.department_id WHERE d.slug = 'council' AND u.status = 'citizen' ORDER BY p.sort, u.id`);
const isCouncillor = (u) => councilMembers().some((m) => m.id === u.id);
const isHeadOf = (u, departmentId) => !!u.position_id && !!q.get("SELECT 1 FROM positions WHERE id = ? AND level = 'head' AND department_id = ?", u.position_id, departmentId);

/** Who may decide an application for this position. */
function deciderRule(p) {
  if (p.level === 'head_of_state') return 'council';
  if (p.level === 'deputy' || p.level === 'staff') return 'head_or_hos';
  return 'hos';
}
function canDecide(u, p) {
  const rule = deciderRule(p);
  if (rule === 'council') return false; // decided only by vote
  return isAdmin(u) || (rule === 'head_or_hos' && isHeadOf(u, p.department_id));
}
const describeRule = (p) => ({ council: 'Chosen by the National Council by majority vote', hos: 'Appointed by the Head of State', head_or_hos: 'Appointed by the head of the department or the Head of State' })[deciderRule(p)];

function positionView(p) {
  const held = holders(p.id);
  return {
    id: p.id, key: p.key, title: p.title, level: p.level, levelLabel: LEVELS[p.level], seats: p.seats, description: p.description,
    department: { id: p.department_id, slug: p.dept_slug, name: p.dept_name },
    holders: held.map((x) => ({ username: x.username, displayName: x.display_name })),
    vacancies: Math.max(0, p.seats - held.length), decidedBy: describeRule(p),
    pending: q.get("SELECT COUNT(*) c FROM office_applications WHERE position_id = ? AND status = 'pending'", p.id).c,
  };
}

function applicationView(a, viewer) {
  const p = position(a.position_id);
  const u = q.get('SELECT username, display_name, citizen_since, position_id FROM users WHERE id = ?', a.user_id);
  const current = u.position_id ? q.get('SELECT title FROM positions WHERE id = ?', u.position_id)?.title : null;
  const out = {
    id: a.id, status: a.status, statement: a.statement, note: a.note, createdAt: a.created_at, decidedAt: a.decided_at,
    position: { id: p.id, title: p.title, level: p.level, department: p.dept_name },
    applicant: { username: u.username, displayName: u.display_name, citizenSince: u.citizen_since, currentOffice: current },
    decidedBy: a.decided_by ? q.get('SELECT username FROM users WHERE id = ?', a.decided_by)?.username : (a.status === 'accepted' || a.status === 'rejected') && p.level === 'head_of_state' ? 'National Council' : null,
  };
  if (p.level === 'head_of_state') {
    const votes = q.all('SELECT v.vote, u.username FROM office_votes v JOIN users u ON u.id = v.user_id WHERE v.application_id = ?', a.id);
    out.votes = { yes: votes.filter((v) => v.vote).length, no: votes.filter((v) => !v.vote).length, electorate: councilMembers().filter((m) => m.id !== a.user_id).length, ballots: votes.map((v) => ({ username: v.username, vote: v.vote ? 'yes' : 'no' })) };
    if (viewer) out.myVote = votes.find((v) => v.username === viewer.username)?.vote ?? null;
  }
  if (viewer) out.canDecide = a.status === 'pending' && a.user_id !== viewer.id && canDecide(viewer, p);
  if (viewer) out.canVote = a.status === 'pending' && p.level === 'head_of_state' && a.user_id !== viewer.id && isCouncillor(viewer);
  return out;
}

/** Puts the applicant into the office. Runs inside a transaction. */
function appoint(a, deciderId, note) {
  const p = position(a.position_id);
  if (holders(p.id).length >= p.seats) throw bad('This position has no vacant seat any more');
  const u = q.get('SELECT * FROM users WHERE id = ?', a.user_id);
  if (u.status !== 'citizen') throw bad('Only citizens can hold office');
  if (p.level === 'head_of_state') q.run("UPDATE users SET role = 'admin', department_id = ?, official_title = ?, position_id = ? WHERE id = ?", p.department_id, p.title, p.id, u.id);
  else q.run("UPDATE users SET role = CASE WHEN role = 'admin' THEN 'admin' ELSE 'official' END, department_id = ?, official_title = ?, position_id = ? WHERE id = ?", p.department_id, p.title, p.id, u.id);
  q.run("UPDATE office_applications SET status = 'accepted', decided_by = ?, note = ?, decided_at = ? WHERE id = ?", deciderId, note || null, now(), a.id);
  if (holders(p.id).length >= p.seats) {
    q.run("UPDATE office_applications SET status = 'rejected', note = 'The position has been filled.', decided_at = ? WHERE position_id = ? AND status = 'pending'", now(), p.id);
  }
  gazette('appointment', `@${u.username} appointed ${p.title}${p.level === 'head_of_state' ? '' : `, ${p.dept_name}`}`,
    p.level === 'head_of_state' ? 'Chosen by the National Council.' : '', `user:${u.id}`);
}

// ---------------------------------------------------------------- reading
r.get('/positions', (req, res) => {
  const list = q.all('SELECT p.*, d.slug dept_slug, d.name dept_name, d.branch, d.sort dsort FROM positions p JOIN departments d ON d.id = p.department_id ORDER BY d.sort, p.sort').map((p) => ({ ...positionView(p), branch: p.branch }));
  res.json({ items: list, vacancies: list.reduce((s, p) => s + p.vacancies, 0) });
});

r.get('/council', (req, res) => {
  const hos = q.get("SELECT id FROM positions WHERE level = 'head_of_state'");
  const elections = q.all("SELECT * FROM office_applications WHERE position_id = ? AND status = 'pending' ORDER BY id", hos.id);
  const council = q.all("SELECT p.*, d.slug dept_slug, d.name dept_name FROM positions p JOIN departments d ON d.id = p.department_id WHERE d.slug = 'council' ORDER BY p.sort");
  res.json({
    members: councilMembers().map((m) => ({ username: m.username, displayName: m.display_name, title: m.title })),
    seats: council.reduce((s, p) => s + p.seats, 0),
    positions: council.map(positionView),
    headOfState: positionView(position(hos.id)),
    elections: elections.map((a) => applicationView(a, req.user)),
    recent: q.all("SELECT * FROM office_applications WHERE position_id = ? AND status IN ('accepted','rejected') ORDER BY decided_at DESC LIMIT 5", hos.id).map((a) => applicationView(a)),
  });
});

r.get('/mine', requireAuth, (req, res) => {
  const office = req.user.position_id ? positionView(position(req.user.position_id)) : null;
  res.json({
    office,
    applications: q.all('SELECT * FROM office_applications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id).map((a) => applicationView(a, req.user)),
    // Applications this citizen may decide or vote on.
    toDecide: q.all("SELECT * FROM office_applications WHERE status = 'pending' AND user_id != ? ORDER BY id", req.user.id)
      .map((a) => applicationView(a, req.user)).filter((a) => a.canDecide || a.canVote),
  });
});

// ---------------------------------------------------------------- applying
r.post('/positions/:id/apply', requirePassport, (req, res) => {
  const p = position(req.params.id);
  if (!p) throw notFound();
  if (req.user.position_id === p.id) throw bad('You already hold this office');
  if (isAdmin(req.user)) throw bad('The Head of State must resign before applying for another office');
  const vacancies = p.seats - holders(p.id).length;
  if (vacancies <= 0) throw bad(p.level === 'head_of_state' ? 'There is a Head of State. Applications open only when the office is vacant.' : 'This position has no vacant seat');
  if (p.level === 'head_of_state' && !councilMembers().some((m) => m.id !== req.user.id)) {
    throw bad('The National Council has no other members to choose a Head of State. Apply for a Council seat first.');
  }
  if (q.get("SELECT 1 FROM office_applications WHERE position_id = ? AND user_id = ? AND status = 'pending'", p.id, req.user.id)) throw bad('You have already applied for this position');
  if (q.get("SELECT COUNT(*) c FROM office_applications WHERE user_id = ? AND status = 'pending'", req.user.id).c >= 3) throw bad('You can have at most 3 applications open at once');
  const statement = str(req.body.statement, 'Your statement', { min: 30, max: 3000 });
  const info = q.run('INSERT INTO office_applications (position_id, user_id, statement, created_at) VALUES (?,?,?,?)', p.id, req.user.id, statement, now());
  if (p.level === 'head_of_state') gazette('appointment', `@${req.user.username} is a candidate for Head of State`, 'The National Council will vote.', `user:${req.user.id}`);
  audit(req.user.id, 'office_applied', { position: p.id });
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

r.post('/applications/:id/withdraw', requireCitizen, (req, res) => {
  const a = q.get('SELECT * FROM office_applications WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!a || a.status !== 'pending') throw bad('This application is not open');
  q.run("UPDATE office_applications SET status = 'withdrawn', decided_at = ? WHERE id = ?", now(), a.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- deciding
// params: { applicationId, decision: 'accept' | 'reject', note }
r.post('/decide', requireAccess('office.decide', (req) => req.body.params), (req, res) => {
  const { applicationId, decision, note } = req.access.params;
  oneOf(decision, 'Decision', ['accept', 'reject']);
  const a = q.get('SELECT * FROM office_applications WHERE id = ?', Number(applicationId));
  if (!a || a.status !== 'pending') throw bad('This application is not open');
  if (a.user_id === req.user.id) throw forbidden('You cannot decide your own application');
  const p = position(a.position_id);
  if (!canDecide(req.user, p)) throw forbidden(deciderRule(p) === 'council' ? 'The National Council decides this by vote' : 'You are not the authority for this position');
  const n = str(note, 'Note', { max: 1000, optional: true });
  if (decision === 'reject' && n.length < 5) throw bad('Explain the decision to the applicant');
  tx(() => {
    if (decision === 'accept') appoint(a, req.user.id, n);
    else q.run("UPDATE office_applications SET status = 'rejected', decided_by = ?, note = ?, decided_at = ? WHERE id = ?", req.user.id, n, now(), a.id);
  });
  audit(req.user.id, `office_${decision}`, { application: a.id, position: p.id });
  res.json({ ok: true });
});

// params: { applicationId, vote: 'yes' | 'no' }
r.post('/vote', requireAccess('office.vote', (req) => req.body.params), (req, res) => {
  const { applicationId, vote } = req.access.params;
  oneOf(vote, 'Vote', ['yes', 'no']);
  const a = q.get('SELECT * FROM office_applications WHERE id = ?', Number(applicationId));
  if (!a || a.status !== 'pending') throw bad('This election is not open');
  const p = position(a.position_id);
  if (p.level !== 'head_of_state') throw bad('Only the Head of State is chosen by Council vote');
  if (a.user_id === req.user.id) throw forbidden('You cannot vote on your own candidacy');
  if (!isCouncillor(req.user)) throw forbidden('Only members of the National Council vote');
  if (q.get('SELECT 1 FROM office_votes WHERE application_id = ? AND user_id = ?', a.id, req.user.id)) throw bad('You have already voted');
  let result = 'open';
  tx(() => {
    q.run('INSERT INTO office_votes (application_id, user_id, vote, created_at) VALUES (?,?,?,?)', a.id, req.user.id, vote === 'yes' ? 1 : 0, now());
    // A strict majority of the Council (not counting the candidate) decides.
    const electorate = councilMembers().filter((m) => m.id !== a.user_id).length;
    const t = q.get('SELECT SUM(vote) yes, SUM(1 - vote) no FROM office_votes WHERE application_id = ?', a.id);
    if (t.yes * 2 > electorate) { appoint(a, null, `Elected by the National Council, ${t.yes} to ${t.no}.`); result = 'elected'; }
    else if (t.no * 2 >= electorate) {
      q.run("UPDATE office_applications SET status = 'rejected', note = ?, decided_at = ? WHERE id = ?", `Not elected by the National Council (${t.yes} for, ${t.no} against).`, now(), a.id);
      result = 'defeated';
    }
  });
  audit(req.user.id, 'office_vote', { application: a.id, vote });
  res.json({ ok: true, result });
});

// ---------------------------------------------------------------- leaving office
r.post('/resign', requirePassport, (req, res) => {
  if (!req.user.position_id) throw bad('You do not hold an office');
  const p = position(req.user.position_id);
  if (p.level === 'head_of_state' && !councilMembers().some((m) => m.id !== req.user.id)) {
    throw bad('Appoint at least one Council member first, so the Council can choose your successor');
  }
  q.run("UPDATE users SET role = 'member', department_id = NULL, official_title = NULL, position_id = NULL WHERE id = ?", req.user.id);
  gazette('appointment', `@${req.user.username} has resigned as ${p.title}`, p.level === 'head_of_state' ? 'The office of Head of State is vacant. Citizens may apply, and the National Council will choose.' : '', `user:${req.user.id}`);
  audit(req.user.id, 'office_resigned', { position: p.id });
  res.json({ ok: true });
});

export default r;
