import { html, mount, icon, num, ago, fmtDate, fmtDateTime, empty, toast, go, statusBadge, titleCase, money, modal, handleForm, confirmBox, qs } from '../ui.js';
import { api } from '../api.js';
import { user, isOfficial, isAdmin } from '../store.js';
import { accessOp, describe } from '../secure.js';

const TABS = [['overview', 'Overview'], ['applications', 'Citizenship applications'], ['users', 'Citizens & officials'], ['keys', 'Key reissues'], ['reports', 'Reports'], ['disputes', 'Market disputes']];

export async function admin(view, _p, query) {
  if (!isOfficial()) return go('/');
  const tab = query.get('tab') || 'overview';
  const stats = await api.get('/api/admin/stats');
  const counts = { applications: stats.pendingApplications, reports: stats.openReports, disputes: stats.disputes, keys: stats.keyRequests };
  mount(view, html`<nav class="crumbs"><a href="#/">Home</a><span>Government console</span></nav>
  <div class="page-head row between"><div><span class="eyebrow">${user().officialTitle || 'Official'}</span><h1>Government console</h1></div>
    <div class="row"><a class="btn" href="#/news/new">${icon('megaphone')} Publish news</a><a class="btn" href="#/records/gazette">${icon('news')} Gazette</a><a class="btn" href="#/records/requests">${icon('archive')} Records requests (${stats.openRecordRequests})</a></div></div>
  <div class="tabs">${TABS.filter(([t]) => (t === 'applications' || t === 'keys' ? stats.canReview : true)).map(([t, l]) => html`<a class="${t === tab ? 'active' : ''}" href="#/admin?tab=${t}">${l}${counts[t] ? html` <span class="badge warn">${counts[t]}</span>` : ''}</a>`)}</div>
  <div data-tab></div>`);
  const el = view.querySelector('[data-tab]');
  const tabs = { overview, applications, users, keys, reports, disputes };
  await (tabs[tab] || overview)(el, stats, query);
}

async function overview(el, s) {
  mount(el, html`<div class="grid g4">${[['users', s.statuses.citizen || 0, 'Citizens'], ['eye', s.pendingApplications, 'Applications to review'], ['flag', s.openReports, 'Open reports'], ['scale', s.disputes, 'Market disputes'], ['key', s.keyRequests, 'Key reissue requests'], ['archive', s.openRecordRequests, 'Open records requests'], ['vote', s.passedBills, 'Bills awaiting assent'], ['user', (s.statuses.email || 0) + (s.statuses.documents || 0), 'Applicants in progress']]
    .map(([i, v, l]) => html`<div class="card stat"><div class="row between"><b>${num(v)}</b><span class="dept-icon" style="width:34px;height:34px">${icon(i)}</span></div><span>${l}</span></div>`)}</div>
  ${s.passedBills && s.isAdmin ? html`<div class="callout warn" style="margin-top:16px">${icon('vote')}<div>${s.passedBills} bill(s) passed the national vote and await your assent. <a href="#/laws/bills?status=passed">Review them</a>.</div></div>` : ''}
  ${s.audit.length ? html`<div class="card" style="margin-top:18px"><div class="card-head"><h3>Audit log</h3><span class="small muted">Head of State only</span></div><div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>
    ${s.audit.map((a) => html`<tr><td class="small nowrap">${ago(a.ts)}</td><td>${a.username ? `@${a.username}` : '—'}</td><td><code>${a.action}</code></td><td class="small muted break">${a.detail || ''}</td></tr>`)}</tbody></table></div></div>` : ''}`);
}

async function applications(el, _s, query) {
  const status = query.get('status') || 'pending';
  const list = await api.get(`/api/admin/applications?status=${status}`);
  mount(el, html`<div class="chips" style="margin-bottom:14px">${['pending', 'approved', 'rejected', 'banned'].map((x) => html`<a class="chip ${x === status ? 'active' : ''}" href="#/admin?tab=applications&status=${x}">${x}</a>`)}</div>
  ${list.length ? html`<div class="card list">${list.map((a) => html`<button class="list-item" data-app="${a.id}" style="width:100%;border:0;background:none;text-align:left;cursor:pointer;font:inherit;color:inherit">
    <div class="grow"><b>${a.legal_name}</b> <span class="muted small">@${a.username}</span><div class="small muted">${titleCase(a.doc_type)} · ${a.country} · submitted ${ago(a.created_at)}</div>
      ${a.flags.length ? html`<div class="row tight" style="margin-top:4px">${a.flags.map((f) => html`<span class="badge ${f.code === 'uploaded_selfie' ? 'warn' : 'bad'}">${titleCase(f.code)}</span>`)}</div>` : ''}</div>
    ${statusBadge(a.status)}</button>`)}</div>` : empty(`No ${status} applications.`, 'check')}`);
  el.querySelectorAll('[data-app]').forEach((b) => b.onclick = () => reviewApplication(Number(b.dataset.app), () => applications(el, _s, query)));
}

async function reviewApplication(id, done) {
  const a = await api.get(`/api/admin/applications/${id}`);
  await modal({ title: `Application #${a.id} — ${a.legal_name}`, subtitle: `@${a.username} · ${a.email}`, iconName: 'id', wide: true }, (body, close) => {
    mount(body, html`<div class="stack">
      <div class="grid g2"><div><div class="small muted" style="margin-bottom:4px">Identity document</div><a href="/api/admin/applications/${a.id}/document" target="_blank"><img src="/api/admin/applications/${a.id}/document" style="border-radius:8px;max-height:260px;margin:0 auto" alt="Document"></a></div>
        <div><div class="small muted" style="margin-bottom:4px">Selfie ${a.live_capture ? html`<span class="badge ok">live capture</span>` : html`<span class="badge warn">uploaded file</span>`}</div><a href="/api/admin/applications/${a.id}/selfie" target="_blank"><img src="/api/admin/applications/${a.id}/selfie" style="border-radius:8px;max-height:260px;margin:0 auto" alt="Selfie"></a></div></div>
      <div class="liveness small">Liveness prompt: ${a.liveness_phrase}</div>
      ${describe([['Legal name', a.legal_name], ['Date of birth', a.dob], ['Document', `${titleCase(a.doc_type)} issued by ${a.country}, ending …${a.doc_last4}`], ['Account created', fmtDateTime(a.user_created)], ['Submitted', fmtDateTime(a.created_at)], ['Status', statusBadge(a.status)], ...(a.reviewer ? [['Reviewed by', `@${a.reviewer} — ${a.review_note || ''}`]] : [])])}
      ${a.flags.length ? html`<div class="callout bad">${icon('alert')}<div><b>Duplicate-person signals</b><ul class="small" style="margin:4px 0 0;padding-left:18px">${a.flags.map((f) => html`<li><b>${titleCase(f.code)}</b>: ${f.detail}</li>`)}</ul></div></div>` : html`<div class="callout ok small">${icon('check')}<div>No duplicate-person signals.</div></div>`}
      ${a.history.length ? html`<div class="small muted">Previous applications: ${a.history.map((h) => `#${h.id} ${h.status}`).join(', ')}</div>` : ''}
      ${a.status === 'pending' ? html`<form class="form" data-decide><label class="field"><span>Note to applicant</span><textarea class="input" name="note" maxlength="1000" style="min-height:70px" placeholder="Required for rejection or ban"></textarea></label>
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn danger" data-d="ban">Ban document</button><button type="button" class="btn" data-d="reject">Reject (may reapply)</button><button type="button" class="btn primary" data-d="approve">${icon('check')} Approve citizenship</button></div>
        <div class="tiny muted right">Decisions require a passport check and are audited. Check the selfie matches the document photo and shows the liveness prompt.</div></form>` : ''}
    </div>`);
    body.querySelectorAll('[data-d]').forEach((b) => b.onclick = async () => {
      const decision = b.dataset.d;
      if (decision === 'ban' && !(await confirmBox('Ban this identity document?', 'The applicant can never become a citizen with this document.', { danger: true, okLabel: 'Ban' }))) return;
      try { await api.post(`/api/admin/applications/${a.id}/decide`, { decision, note: body.querySelector('[name=note]').value.trim() }); toast(`Application ${decision === 'approve' ? 'approved' : decision === 'ban' ? 'banned' : 'rejected'}`, 'ok'); close(true); } catch (e) { toast(e.message, 'bad'); }
    });
  });
  done();
}

async function users(el, _s, query) {
  const term = query.get('q') || '';
  const [list, depts] = await Promise.all([api.get(`/api/admin/users${qs({ q: term })}`), api.get('/api/gov/departments')]);
  const deptName = (id) => depts.find((d) => d.id === id)?.short || '';
  mount(el, html`<form class="row" data-search style="margin-bottom:14px"><input class="input" name="q" value="${term}" placeholder="Search accounts, passports${isAdmin() ? ', emails' : ''}" style="max-width:360px"><button class="btn">${icon('search')}</button></form>
  <div class="card table-wrap"><table class="table"><thead><tr><th>Account</th><th>Status</th><th>Office</th><th>Passport</th><th>Joined</th>${isAdmin() ? html`<th></th>` : ''}</tr></thead><tbody>
  ${list.map((u) => html`<tr><td><a href="#/citizen/${u.username}"><b>${u.display_name}</b></a><div class="tiny muted">@${u.username}${u.email ? ` · ${u.email}` : ''}</div></td><td>${statusBadge(u.status)}</td>
    <td class="small">${u.role !== 'member' ? html`<span class="badge official">${u.official_title || u.role}</span><div class="tiny muted">${deptName(u.department_id)}</div>` : html`<span class="muted">—</span>`}</td>
    <td class="mono small">${u.passport_no || '—'}</td><td class="small nowrap">${fmtDate(u.created_at)}</td>
    ${isAdmin() ? html`<td class="nowrap">${['citizen', 'suspended'].includes(u.status) ? html`${u.status === 'citizen' ? html`<button class="btn sm" data-appoint="${u.id}">Appoint</button>` : ''}
      ${u.id !== user().id ? html`<button class="btn sm ${u.status === 'citizen' ? 'danger' : ''}" data-status="${u.id}" data-to="${u.status === 'citizen' ? 'suspended' : 'citizen'}">${u.status === 'citizen' ? 'Suspend' : 'Reinstate'}</button>` : ''}` : ''}</td>` : ''}</tr>`)}</tbody></table></div>`);
  el.querySelector('[data-search]').onsubmit = (e) => { e.preventDefault(); go(`/admin${qs({ tab: 'users', q: e.target.q.value.trim() })}`); };
  const reload = () => users(el, _s, query);
  el.querySelectorAll('[data-appoint]').forEach((b) => b.onclick = async () => {
    const u = list.find((x) => x.id === Number(b.dataset.appoint));
    const choice = await modal({ title: `Appoint @${u.username}`, iconName: 'crown' }, (body, close) => {
      mount(body, html`<form class="form"><label class="field"><span>Role</span><select class="input" name="role"><option value="official" ${u.role === 'official' ? 'selected' : ''}>Official</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Head of State (admin)</option><option value="member" ${u.role === 'member' ? 'selected' : ''}>Private citizen (remove from office)</option></select></label>
        <label class="field"><span>Department</span><select class="input" name="departmentId"><option value="">—</option>${depts.map((d) => html`<option value="${d.id}" ${d.id === u.department_id ? 'selected' : ''}>${d.name}</option>`)}</select></label>
        <label class="field"><span>Title</span><input class="input" name="title" value="${u.official_title || ''}" placeholder="e.g. Registrar, Secretary of Commerce"></label>
        <div class="row" style="justify-content:flex-end"><button class="btn primary">Continue</button></div></form>`);
      body.querySelector('form').onsubmit = (e) => { e.preventDefault(); const f = e.target; close({ role: f.role.value, departmentId: f.departmentId.value ? Number(f.departmentId.value) : null, title: f.title.value.trim() }); };
    });
    if (!choice) return;
    const params = { userId: u.id, ...choice };
    const ok = await accessOp({ op: 'admin.role', params, title: 'Sign appointment', summary: describe([['Citizen', `@${u.username}`], ['Role', choice.role], ['Department', deptName(choice.departmentId) || '—'], ['Title', choice.title || '—']]), submit: (auth) => api.post('/api/admin/users/role', { params, auth }) });
    if (ok) { toast('Appointment published in the Gazette', 'ok'); reload(); }
  });
  el.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => {
    const u = list.find((x) => x.id === Number(b.dataset.status));
    const params = { userId: u.id, status: b.dataset.to };
    const ok = await accessOp({ op: 'admin.status', params, title: `${params.status === 'suspended' ? 'Suspend' : 'Reinstate'} @${u.username}`, summary: html`This is published in the Official Gazette.`, submit: (auth) => api.post('/api/admin/users/status', { params, auth }) });
    if (ok) { toast('Done', 'ok'); reload(); }
  });
}

async function keys(el) {
  const list = await api.get('/api/admin/key-requests');
  mount(el, list.length ? html`<div class="card list">${list.map((u) => html`<div class="list-item"><div class="grow"><b>${u.display_name}</b> <span class="small muted">@${u.username} · ${u.passport_no} · ${u.legal_name || ''}</span>
    <div class="small muted">Reported a lost .access key. Approving lets them generate a new key; old passport images and the old key stop working.</div></div>
    <button class="btn sm primary" data-allow="${u.id}">Approve reissue</button><button class="btn sm" data-deny="${u.id}">Deny</button></div>`)}</div>` : empty('No key reissue requests.', 'key'));
  el.querySelectorAll('[data-allow],[data-deny]').forEach((b) => b.onclick = async () => {
    await api.post(`/api/admin/users/${b.dataset.allow || b.dataset.deny}/allow-reissue`, { deny: !!b.dataset.deny });
    toast('Done', 'ok'); keys(el);
  });
}

async function reports(el) {
  const list = await api.get('/api/admin/reports');
  const link = (r) => (r.kind === 'post' && r.target ? `#/forum/t/${r.target.thread_id}` : r.kind === 'thread' ? `#/forum/t/${r.target_id}` : r.kind === 'listing' ? `#/market/l/${r.target_id}` : r.target ? `#/citizen/${r.target.username}` : '#/');
  mount(el, list.length ? html`<div class="stack">${list.map((r) => html`<div class="card"><div class="card-head"><div><span class="badge">${r.kind}</span> reported by @${r.reporter} · ${ago(r.created_at)}</div><a class="small" href="${link(r)}">Open ${icon('arrow')}</a></div>
    <div class="pad stack tight"><div><b>Reason:</b> ${r.reason}</div>${r.target ? html`<div class="secure-summary small">${r.target.title || r.target.body || ''} <span class="muted">— @${r.target.username}</span></div>` : html`<div class="small muted">Target no longer exists.</div>`}
    <div class="row"><button class="btn sm danger" data-resolve="${r.id}" data-action="remove">Remove content</button><button class="btn sm" data-resolve="${r.id}" data-action="dismiss">Dismiss</button></div></div></div>`)}</div>` : empty('No open reports.', 'flag'));
  el.querySelectorAll('[data-resolve]').forEach((b) => b.onclick = async () => { await api.post(`/api/admin/reports/${b.dataset.resolve}/resolve`, { action: b.dataset.action }); toast('Resolved', 'ok'); reports(el); });
}

async function disputes(el) {
  const list = await api.get('/api/market/disputes');
  mount(el, list.length ? html`<div class="card list">${list.map((o) => html`<a class="list-item" href="#/market/orders/${o.id}"><div class="grow"><b>Order #${o.id}: ${o.listing?.title}</b><div class="small muted">@${o.buyer.username} vs @${o.seller.username} · ${ago(o.updated_at)}</div></div>${money(o.total)}</a>`)}</div>` : empty('No open disputes.', 'scale'));
}
