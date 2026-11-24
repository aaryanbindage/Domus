import { html, mount, icon, toast, handleForm, go, fmtDate, num, modal, confirmBox, statusBadge, empty, avatar } from '../ui.js';
import { api } from '../api.js';
import { user, nation, isCitizen, refreshMe } from '../store.js';
import { accessOp, describe } from '../secure.js';

const crumbs = (...items) => html`<nav class="crumbs"><a href="#/">Home</a>${items.map(([label, href]) => html`<span>${href ? html`<a href="${href}">${label}</a>` : label}</span>`)}</nav>`;
const BRANCHES = [['executive', 'Executive'], ['legislative', 'Legislature & Council'], ['judicial', 'Judiciary'], ['agency', 'Departments & agencies']];
const LEVEL_BADGE = { head_of_state: 'gold', council: 'blue', head: 'blue', deputy: '', staff: '' };

const seatsLine = (p) => (p.vacancies
  ? html`<span class="badge ok">${p.vacancies} vacant</span> <span class="tiny muted">${p.seats - p.vacancies} of ${p.seats} filled</span>`
  : html`<span class="badge">Filled</span> <span class="tiny muted">${p.seats} of ${p.seats}</span>`);
const holderLinks = (p) => (p.holders.length ? p.holders.map((h, i) => html`${i ? ', ' : ''}<a href="#/citizen/${h.username}">${h.displayName}</a>`) : html`<span class="muted">Vacant</span>`);

/** Opens the application form for a position; resolves true when submitted. */
async function applyFor(p) {
  if (!isCitizen()) { toast('Only citizens can apply for public office', 'bad'); return false; }
  return modal({ title: `Apply: ${p.title}`, subtitle: p.department.name, iconName: 'file' }, (body, close) => {
    mount(body, html`<form class="form" data-f>
      <p class="small muted" style="margin:0">${p.description} <b>${p.decidedBy}.</b></p>
      <label class="field"><span>Why should you hold this office?</span><textarea class="input" name="statement" required minlength="30" maxlength="3000" style="min-height:140px" placeholder="Your experience, what you would do, and how much time you can give."></textarea><small>At least 30 characters. The deciders read this; it is not published.</small></label>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary" type="submit">${icon('send')} Submit application</button></div></form>`);
    body.querySelector('[data-cancel]').onclick = () => close(false);
    handleForm(body.querySelector('[data-f]'), async (d) => {
      await api.post(`/api/offices/positions/${p.id}/apply`, { statement: d.statement });
      toast('Application submitted', 'ok'); close(true);
    });
  });
}

async function decide(a, decision, rerender) {
  let note = '';
  if (decision === 'reject') {
    note = await new Promise((resolve) => modal({ title: 'Reason for rejection', iconName: 'alert' }, (body, close) => {
      mount(body, html`<form class="form" data-f><label class="field"><span>Note to @${a.applicant.username}</span><textarea class="input" name="note" required minlength="5" maxlength="1000"></textarea></label>
        <div class="row" style="justify-content:flex-end"><button class="btn danger" type="submit">Continue</button></div></form>`);
      handleForm(body.querySelector('[data-f]'), async (d) => { close(d.note); });
    }).then(resolve));
    if (!note) return;
  }
  const params = { applicationId: a.id, decision, note };
  const done = await accessOp({ op: 'office.decide', params, title: decision === 'accept' ? 'Sign appointment' : 'Sign rejection',
    summary: describe([['Applicant', `@${a.applicant.username}`], ['Office', `${a.position.title}, ${a.position.department}`], ['Decision', decision === 'accept' ? 'Appoint' : 'Reject']]),
    submit: (auth) => api.post('/api/offices/decide', { params, auth }) });
  if (done) { toast(decision === 'accept' ? `@${a.applicant.username} appointed ${a.position.title}` : 'Application rejected', 'ok'); rerender(); }
}

async function vote(a, choice, rerender) {
  const params = { applicationId: a.id, vote: choice };
  const done = await accessOp({ op: 'office.vote', params, title: 'Sign Council vote',
    summary: describe([['Candidate', `@${a.applicant.username}`], ['Office', 'Head of State'], ['Your vote', choice === 'yes' ? 'In favour' : 'Against']]),
    submit: (auth) => api.post('/api/offices/vote', { params, auth }) });
  if (done) { await refreshMe(); toast('Vote recorded', 'ok'); rerender(); }
}

/** One application, with the actions the viewer may take on it. */
function applicationCard(a, rerender, { mine = false } = {}) {
  const node = html`<div class="card pad stack tight">
    <div class="row between"><div><b>${a.position.title}</b> <span class="small muted">· ${a.position.department}</span></div>${statusBadge(a.status)}</div>
    ${mine ? '' : html`<div class="row tight">${avatar(a.applicant.displayName)}<div><a href="#/citizen/${a.applicant.username}"><b>${a.applicant.displayName}</b></a> <span class="small muted">@${a.applicant.username}${a.applicant.citizenSince ? ` · citizen since ${fmtDate(a.applicant.citizenSince)}` : ''}${a.applicant.currentOffice ? ` · now ${a.applicant.currentOffice}` : ''}</span></div></div>`}
    ${a.statement && (mine || a.canDecide || a.canVote) ? html`<p class="small" style="margin:0;white-space:pre-wrap">${a.statement}</p>` : ''}
    ${a.votes ? html`<div class="small"><b>Council vote:</b> ${a.votes.yes} for · ${a.votes.no} against · ${a.votes.electorate} member${a.votes.electorate === 1 ? '' : 's'} voting (more than half needed)${a.votes.ballots.length ? html`<div class="tiny muted">${a.votes.ballots.map((b) => `@${b.username}: ${b.vote}`).join(' · ')}</div>` : ''}</div>` : ''}
    ${a.note ? html`<div class="small muted">${a.note}</div>` : ''}
    <div class="tiny muted">Applied ${fmtDate(a.createdAt)}${a.decidedAt ? ` · decided ${fmtDate(a.decidedAt)}${a.decidedBy ? ` by ${a.decidedBy.startsWith('National') ? a.decidedBy : `@${a.decidedBy}`}` : ''}` : ''}</div>
    <div class="row" data-actions style="justify-content:flex-end"></div></div>`;
  return { node, wire(root) {
    const box = root.querySelector(`[data-app="${a.id}"] [data-actions]`);
    if (!box) return;
    if (mine && a.status === 'pending') {
      mount(box, html`<button class="btn sm ghost" data-w>Withdraw</button>`);
      box.querySelector('[data-w]').onclick = async () => {
        if (!(await confirmBox('Withdraw this application?', 'You can apply again later while a seat is vacant.'))) return;
        await api.post(`/api/offices/applications/${a.id}/withdraw`, {}); toast('Application withdrawn', 'ok'); rerender();
      };
    } else if (a.canDecide) {
      mount(box, html`<button class="btn sm" data-d="reject">Reject</button><button class="btn sm primary" data-d="accept">${icon('check')} Appoint</button>`);
      box.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => decide(a, b.dataset.d, rerender); });
    } else if (a.canVote && a.myVote == null) {
      mount(box, html`<button class="btn sm danger" data-v="no">Vote against</button><button class="btn sm primary" data-v="yes">${icon('vote')} Vote in favour</button>`);
      box.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => vote(a, b.dataset.v, rerender); });
    } else if (a.canVote) mount(box, html`<span class="small muted">You voted ${a.myVote ? 'in favour' : 'against'}</span>`);
  } };
}

function applicationList(items, rerender, opts) {
  const cards = items.map((a) => applicationCard(a, rerender, opts));
  const node = html`<div class="stack">${cards.map((c, i) => html`<div data-app="${items[i].id}">${c.node}</div>`)}</div>`;
  return { node, wire: (root) => cards.forEach((c) => c.wire(root)) };
}

// ---------------------------------------------------------------- Applications Office
export async function offices(view, _p, query) {
  const tab = query.get('tab') || 'open';
  const [d, mine] = await Promise.all([api.get('/api/offices/positions'), user() ? api.get('/api/offices/mine') : null]);
  const rerender = () => offices(view, _p, query);
  const tabs = [['open', `Open positions`, d.vacancies], ...(mine ? [['mine', 'My applications', mine.applications.filter((a) => a.status === 'pending').length]] : []),
    ...(mine?.toDecide.length ? [['decide', 'To decide', mine.toDecide.length]] : [])];
  const filter = query.get('filter') || 'vacant';

  let body;
  let wire = () => {};
  if (tab === 'mine' && mine) {
    const list = applicationList(mine.applications, rerender, { mine: true });
    wire = list.wire;
    body = html`<div class="split"><div>${mine.applications.length ? list.node : empty('You have not applied for any office yet.', 'file', html`<div style="margin-top:10px"><a class="btn primary" href="#/offices">See open positions</a></div>`)}</div>
      <aside class="stack"><div class="card pad stack tight"><h3 style="margin:0">Your office</h3>
        ${mine.office ? html`<div><b>${mine.office.title}</b><div class="small muted">${mine.office.department.name}</div></div><button class="btn sm danger" data-resign>Resign from office</button>` : html`<p class="small muted" style="margin:0">You don't hold a public office.</p>`}</div></aside></div>`;
  } else if (tab === 'decide' && mine) {
    const list = applicationList(mine.toDecide, rerender);
    wire = list.wire;
    body = html`<p class="muted" style="margin-top:0">Applications you are the authority for. Decisions and votes are signed with your .access key and published in the Gazette.</p>${list.node}`;
  } else {
    const shown = d.items.filter((p) => filter === 'all' || p.vacancies);
    body = html`<div class="chips" style="margin-bottom:18px"><a class="chip ${filter === 'vacant' ? 'active' : ''}" href="#/offices">Vacant seats</a><a class="chip ${filter === 'all' ? 'active' : ''}" href="#/offices?filter=all">All offices</a></div>
    ${shown.length ? BRANCHES.map(([b, label]) => {
      const ps = shown.filter((p) => p.branch === b);
      return ps.length ? html`<h2 style="margin-top:22px">${label}</h2><div class="card"><div class="list">${ps.map((p) => html`<div class="list-item" style="align-items:flex-start;gap:14px">
        <div class="grow stack tight" style="gap:4px"><div><b>${p.title}</b> <span class="badge ${LEVEL_BADGE[p.level]}">${p.levelLabel}</span></div>
          <div class="small muted">${p.department.name} · ${p.decidedBy}</div>
          <div class="small">${p.description}</div>
          <div class="small">Held by: ${holderLinks(p)}</div></div>
        <div class="stack tight" style="justify-items:end;gap:6px;min-width:150px"><div>${seatsLine(p)}</div>
          ${p.vacancies && isCitizen() ? html`<button class="btn sm primary" data-apply="${p.id}">Apply</button>` : ''}
          ${p.pending ? html`<span class="tiny muted">${p.pending} applicant${p.pending === 1 ? '' : 's'}</span>` : ''}</div></div>`)}</div></div>` : '';
    }) : empty('Every public office is filled right now. Check back later, or see all offices.', 'file')}`;
  }

  mount(view, html`${crumbs(['Government', '#/government'], ['Applications Office'])}
  <div class="page-head row between"><div><span class="eyebrow">Applications Office</span><h1>Serve ${nation().name}</h1>
    <p>Every public office is open to citizens. Apply for a vacant seat: heads of department and Council seats are appointed by the Head of State, deputies and officers by their head of department, and the Head of State is chosen by the <a href="#/council">National Council</a>.</p></div>
    ${isCitizen() ? '' : html`<a class="btn primary" href="#/join">Become a citizen to apply</a>`}</div>
  <div class="tabs">${tabs.map(([k, l, n]) => html`<a class="${k === tab ? 'active' : ''}" href="#/offices${k === 'open' ? '' : `?tab=${k}`}">${l}${n ? html` <span class="faint">${n}</span>` : ''}</a>`)}</div>
  ${body}`);

  wire(view);
  view.querySelectorAll('[data-apply]').forEach((b) => {
    b.onclick = async () => { if (await applyFor(d.items.find((p) => p.id === Number(b.dataset.apply)))) go('/offices?tab=mine'); };
  });
  const resign = view.querySelector('[data-resign]');
  if (resign) {
    resign.onclick = async () => {
      if (!(await confirmBox(`Resign as ${mine.office.title}?`, 'Your resignation is published in the Gazette and the seat becomes vacant.', { danger: true, okLabel: 'Resign' }))) return;
      try { await api.post('/api/offices/resign', {}); await refreshMe(); toast('You have resigned', 'ok'); rerender(); } catch (e) { toast(e.message, 'bad'); }
    };
  }
}

// ---------------------------------------------------------------- National Council
export async function council(view) {
  const d = await api.get('/api/offices/council');
  const rerender = () => council(view);
  const hos = d.headOfState;
  const elections = applicationList(d.elections, rerender);
  mount(view, html`${crumbs(['Government', '#/government'], ['National Council'])}
  <div class="page-head row between"><div><span class="eyebrow">Legislature</span><h1>The National Council</h1>
    <p>${d.seats} citizens who advise the government, hold it to account, and choose the Head of State whenever the office falls vacant.</p></div>
    <a class="btn primary" href="#/offices">${icon('file')} Apply for a seat</a></div>
  <div class="split"><div class="stack">
    <div class="card"><div class="card-head"><h3>Members</h3><span class="small muted">${d.members.length} of ${d.seats} seats filled</span></div>
      ${d.members.length ? html`<div class="list">${d.members.map((m) => html`<div class="list-item"><div class="row tight">${avatar(m.displayName)}<div><a href="#/citizen/${m.username}"><b>${m.displayName}</b></a><div class="small muted">${m.title}</div></div></div></div>`)}</div>`
        : empty('No one sits on the Council yet. Citizens can apply through the Applications Office; the Head of State appoints members.', 'users')}</div>
    <div class="card"><div class="card-head"><h3>Choosing a Head of State</h3>${hos.vacancies ? html`<span class="badge bad">Office vacant</span>` : ''}</div><div class="pad stack">
      ${hos.vacancies
        ? html`<p class="small" style="margin:0">The office of Head of State is vacant. Any citizen may stand as a candidate; each is put to a vote of the Council and is chosen with the support of more than half of its members.</p>
          ${isCitizen() ? html`<div><button class="btn primary sm" data-stand>Stand for Head of State</button></div>` : ''}`
        : html`<p class="small" style="margin:0">The current Head of State is ${holderLinks(hos)}. If the office falls vacant, candidates apply here and the Council votes.</p>`}
      ${d.elections.length ? elections.node : hos.vacancies ? empty('No candidates yet.', 'vote') : ''}
      ${d.recent.length ? html`<div class="stack tight"><b class="small">Past decisions</b>${d.recent.map((a) => html`<div class="small row between"><span>@${a.applicant.username}</span><span>${statusBadge(a.status === 'accepted' ? 'elected' : 'not elected')} <span class="muted">${fmtDate(a.decidedAt)}</span></span></div>`)}</div>` : ''}
    </div></div>
  </div><aside class="stack">
    <div class="card pad stack tight"><h3 style="margin:0">Powers of the Council</h3>
      <ul class="small" style="margin:0;padding-left:18px"><li>Advises the government and questions officials in the open forum.</li><li>Chooses the Head of State when the office is vacant, by majority vote.</li><li>Votes are signed with each member's .access key and published.</li></ul>
      <a class="small" href="#/laws?q=National%20Council%20Act">Read the National Council Act</a></div>
    <div class="card pad stack tight"><h3 style="margin:0">Seats</h3>${d.positions.map((p) => html`<div class="row between small"><span>${p.title}</span>${seatsLine(p)}</div>`)}</div>
  </aside></div>`);
  elections.wire(view);
  const stand = view.querySelector('[data-stand]');
  if (stand) stand.onclick = async () => { if (await applyFor(hos)) rerender(); };
}
