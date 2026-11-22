import { html, mount, icon, md, fmtDate, fmtDateTime, ago, until, num, statusBadge, userLink, pager, empty, handleForm, toast, go, confirmBox, promptBox, qs } from '../ui.js';
import { api } from '../api.js';
import { state, user, nation, isCitizen, isOfficial, isAdmin } from '../store.js';
import { accessOp, requirePassport, describe } from '../secure.js';
import { deptIcon, voteBar } from './home.js';

const crumbs = (...items) => html`<nav class="crumbs"><a href="#/">Home</a>${items.map(([label, href]) => html`<span>${href ? html`<a href="${href}">${label}</a>` : label}</span>`)}</nav>`;

// ---------------------------------------------------------------- news
export async function newsList(view, _p, query) {
  const page = Number(query.get('page') || 1);
  const category = query.get('category') || '';
  const d = await api.get(`/api/gov/news${qs({ page, category })}`);
  mount(view, html`${crumbs(['News'])}
  <div class="page-head row between"><div><h1>News &amp; announcements</h1><p>Official communications from the departments of the ${nation().name}.</p></div>
    ${isOfficial() ? html`<a class="btn primary" href="#/news/new">${icon('plus')} Publish article</a>` : ''}</div>
  <div class="chips" style="margin-bottom:18px"><a class="chip ${!category ? 'active' : ''}" href="#/news">All</a>${d.categories.map((c) => html`<a class="chip ${c === category ? 'active' : ''}" href="#/news?category=${c}">${c}</a>`)}</div>
  ${d.items.length ? html`<div class="grid g3">${d.items.map((a) => html`<a class="card link pad stack tight" href="#/news/${a.id}">
    <div class="row tight"><span class="badge blue">${a.category}</span>${a.pinned ? html`<span class="badge gold">Pinned</span>` : ''}</div>
    <h3 style="margin:0">${a.title}</h3><p class="small muted" style="margin:0">${a.summary}</p>
    <div class="tiny faint">${a.dept || 'Government'} · ${fmtDate(a.published_at)}</div></a>`)}</div>` : empty('No articles in this category yet.', 'news')}
  ${pager(d.page, d.pages, (p) => `#/news${qs({ page: p, category })}`)}`);
}

export async function newsView(view, { id }) {
  const a = await api.get(`/api/gov/news/${id}`);
  const canRetract = isAdmin() || (a.author && a.author.id === user()?.id);
  mount(view, html`${crumbs(['News', '#/news'], [a.title])}
  <article class="card pad-lg" style="padding:clamp(20px,4vw,44px)">
    <div class="row tight"><span class="badge blue">${a.category}</span>${a.department ? html`<a class="badge" href="#/government/${a.department.slug}">${a.department.name}</a>` : ''}</div>
    <h1 style="margin-top:12px">${a.title}</h1>
    <p class="muted" style="font-size:1.1rem">${a.summary}</p>
    <div class="small muted" style="margin-bottom:20px">${fmtDateTime(a.published_at)}${a.author ? html` · ${userLink(a.author)}` : ''}</div>
    <hr><div class="prose">${md(a.body)}</div>
    ${canRetract ? html`<hr><button class="btn danger sm" data-retract>${icon('trash')} Retract article</button>` : ''}
  </article>`);
  view.querySelector('[data-retract]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Retract this article?', 'It will be removed from the public record of news. The retraction is logged.', { danger: true, okLabel: 'Retract' }))) return;
    await api.del(`/api/gov/news/${id}`); toast('Article retracted'); go('/news');
  });
}

export async function newsNew(view) {
  if (!isOfficial()) return go('/news');
  const [cats, depts] = await Promise.all([api.get('/api/gov/news'), api.get('/api/gov/departments')]);
  mount(view, html`${crumbs(['News', '#/news'], ['Publish'])}<h1>Publish an official article</h1>
  <form class="card pad form" data-form style="max-width:820px">
    <label class="field"><span>Headline</span><input class="input" name="title" required minlength="5" maxlength="160"></label>
    <label class="field"><span>Summary</span><textarea class="input" name="summary" required minlength="10" maxlength="400" style="min-height:70px"></textarea></label>
    <div class="grid g2"><label class="field"><span>Category</span><select class="input" name="category">${cats.categories.map((c) => html`<option>${c}</option>`)}</select></label>
      ${isAdmin() ? html`<label class="field"><span>Department</span><select class="input" name="departmentId">${depts.map((d) => html`<option value="${d.id}" ${d.id === user().departmentId ? 'selected' : ''}>${d.name}</option>`)}</select></label>` : ''}</div>
    <label class="field"><span>Article</span><textarea class="input" name="body" required minlength="20" style="min-height:280px"></textarea><small>Formatting: **bold**, *italic*, # headings, - lists, [links](https://…)</small></label>
    ${isAdmin() ? html`<label class="check"><input type="checkbox" name="pinned" value="1"> Pin to the top of the news</label>` : ''}
    <div><button class="btn primary" type="submit">${icon('megaphone')} Publish</button></div></form>`);
  handleForm(view.querySelector('[data-form]'), async (d) => { const r = await api.post('/api/gov/news', { ...d, pinned: !!d.pinned }); toast('Published', 'ok'); go(`/news/${r.id}`); });
}

// ---------------------------------------------------------------- departments
const BRANCHES = [['executive', 'Executive'], ['legislative', 'Legislature'], ['judicial', 'Judiciary'], ['agency', 'Departments & agencies']];
export async function departments(view) {
  const list = await api.get('/api/gov/departments');
  mount(view, html`${crumbs(['Government'])}
  <div class="page-head"><h1>The Government</h1><p>${nation().name} is a direct democracy: citizens make the laws, the Head of State gives assent, the Tribunal interprets, and departments serve.</p></div>
  ${BRANCHES.map(([b, label]) => {
    const ds = list.filter((d) => d.branch === b);
    return ds.length ? html`<h2 style="margin-top:26px">${label}</h2><div class="grid g3">${ds.map((d) => html`<a class="card link pad stack tight" href="#/government/${d.slug}">
      <div class="row"><span class="dept-icon">${deptIcon(d.icon)}</span><div><b>${d.name}</b><div class="tiny muted">${d.head_title} · ${d.staff} official${d.staff === 1 ? '' : 's'}</div></div></div>
      <p class="small muted" style="margin:0">${d.mission}</p></a>`)}</div>` : '';
  })}`);
}

export async function department(view, { slug }) {
  const d = await api.get(`/api/gov/departments/${slug}`);
  mount(view, html`${crumbs(['Government', '#/government'], [d.short])}
  <div class="card pad-lg row" style="padding:28px;align-items:flex-start;margin-bottom:20px">
    <span class="dept-icon" style="width:64px;height:64px">${deptIcon(d.icon)}</span>
    <div class="grow"><span class="branch">${d.branch}</span><h1 style="margin:4px 0 6px">${d.name}</h1><p class="muted" style="margin:0;font-size:1.05rem">${d.mission}</p></div>
  </div>
  <div class="split"><div class="stack">
    <div class="card pad"><h3>About</h3><p style="margin:0">${d.description}</p></div>
    <div class="card"><div class="card-head"><h3>Services</h3></div><div class="list">${d.services.map((s) => html`<a class="list-item" href="${s.href}"><span class="grow"><b>${s.label}</b></span>${icon('arrow')}</a>`)}</div></div>
    ${d.laws.length ? html`<div class="card"><div class="card-head"><h3>Laws administered</h3></div><div class="list">${d.laws.map((l) => html`<a class="list-item" href="#/laws/${l.id}"><span class="badge">${l.code}</span><b class="grow">${l.title}</b></a>`)}</div></div>` : ''}
    <div class="card"><div class="card-head"><h3>Recent news</h3></div>${d.news.length ? html`<div class="list">${d.news.map((n) => html`<a class="list-item" href="#/news/${n.id}" style="display:block"><b>${n.title}</b><div class="small muted">${fmtDate(n.published_at)} · ${n.summary}</div></a>`)}</div>` : empty('No news from this department yet.', 'news')}</div>
  </div><aside class="stack">
    <div class="card pad">${describe([['Head', d.head_title], ['Contact', html`<span class="mono small">${d.contact}</span>`], ['Records requests', `${d.requests?.total || 0} total · ${d.requests?.open || 0} open`]])}</div>
    <div class="card"><div class="card-head"><h3>Officials</h3></div>${d.staff.length ? html`<div class="list">${d.staff.map((s) => html`<div class="list-item"><div><a href="#/citizen/${s.username}"><b>${s.displayName}</b></a><div class="small muted">${s.officialTitle || 'Official'}</div></div></div>`)}</div>` : html`<div class="empty small">This office is vacant. The Head of State appoints officials.</div>`}</div>
  </aside></div>`);
}

// ---------------------------------------------------------------- laws
export async function laws(view, _p, query) {
  const kind = query.get('kind') || '';
  const term = query.get('q') || '';
  const list = await api.get(`/api/gov/laws${qs({ kind, q: term })}`);
  mount(view, html`${crumbs(['Laws'])}
  <div class="page-head row between"><div><h1>Constitution &amp; laws</h1><p>The statute book of the ${nation().name}, including every Act passed by national vote.</p></div>
    <a class="btn primary" href="#/laws/bills">${icon('vote')} Bills &amp; national votes</a></div>
  <div class="tabs"><a class="${!kind ? 'active' : ''}" href="#/laws">All</a><a class="${kind === 'constitution' ? 'active' : ''}" href="#/laws?kind=constitution">Constitution</a><a class="${kind === 'act' ? 'active' : ''}" href="#/laws?kind=act">Acts</a><a href="#/laws/bills">Bills</a></div>
  <form class="row" data-search style="margin-bottom:18px"><input class="input grow" name="q" placeholder="Search the law…" value="${term}" style="max-width:420px"><button class="btn">${icon('search')} Search</button></form>
  ${list.length ? html`<div class="card list">${list.map((l) => html`<a class="list-item" href="#/laws/${l.id}">
    <span class="dept-icon">${icon(l.kind === 'constitution' ? 'crown' : 'scale')}</span>
    <div class="grow"><div class="row tight"><span class="badge ${l.kind === 'constitution' ? 'gold' : 'blue'}">${l.code}</span>${statusBadge(l.status)}${l.bill_id ? html`<span class="badge ok">Citizen-made</span>` : ''}</div>
      <b style="display:block;margin:4px 0 2px">${l.title}</b><div class="small muted">${l.summary}</div></div><span class="small faint nowrap">${fmtDate(l.enacted_at)}</span></a>`)}</div>` : empty('No laws match your search.', 'search')}`);
  view.querySelector('[data-search]').onsubmit = (e) => { e.preventDefault(); go(`/laws${qs({ kind, q: e.target.q.value.trim() })}`); };
}

export async function law(view, { id }) {
  const l = await api.get(`/api/gov/laws/${id}`);
  mount(view, html`${crumbs(['Laws', '#/laws'], [l.code])}
  <div class="split"><article class="card pad-lg" style="padding:clamp(20px,4vw,44px)">
    <div class="row tight"><span class="badge ${l.kind === 'constitution' ? 'gold' : 'blue'}">${l.code}</span>${statusBadge(l.status)}</div>
    <h1 style="margin-top:12px">${l.title}</h1><p class="muted">${l.summary}</p><hr>
    <div class="prose">${md(l.body)}</div></article>
  <aside class="stack"><div class="card pad">${describe([['Type', l.kind], ['In force since', fmtDate(l.enacted_at)], ['Administered by', l.department ? html`<a href="#/government/${l.department.slug}">${l.department.name}</a>` : '—'], ['Origin', l.bill_id ? html`<a href="#/laws/bills/${l.bill_id}">Bill #${l.bill_id} (national vote)</a>` : 'Founding law']])}</div>
    <div class="card pad small muted">Want to change this law? <a href="#/laws/bills/new">Propose a bill</a> — any citizen can.</div></aside></div>`);
}

// ---------------------------------------------------------------- bills
export async function bills(view, _p, query) {
  const status = query.get('status') || '';
  const d = await api.get(`/api/gov/bills${qs({ status })}`);
  mount(view, html`${crumbs(['Laws', '#/laws'], ['Bills'])}
  <div class="page-head row between"><div><h1>Bills &amp; national votes</h1><p>Any citizen may table a bill. With ${d.threshold} signatures it opens for a national vote; each vote is signed with the voter’s .access key.</p></div>
    ${isCitizen() ? html`<a class="btn primary" href="#/laws/bills/new">${icon('plus')} Propose a bill</a>` : ''}</div>
  <div class="chips" style="margin-bottom:18px">${[['', 'All'], ['voting', 'In vote'], ['gathering', 'Gathering signatures'], ['passed', 'Awaiting assent'], ['enacted', 'Enacted'], ['failed', 'Failed']].map(([s, l]) => html`<a class="chip ${s === status ? 'active' : ''}" href="#/laws/bills${qs({ status: s })}">${l}</a>`)}</div>
  ${d.items.length ? html`<div class="stack">${d.items.map((b) => html`<a class="card link pad" href="#/laws/bills/${b.id}">
    <div class="row between"><div class="row tight">${statusBadge(b.status)}<span class="small faint">Bill #${b.id}</span></div>
      <span class="small muted">${b.status === 'voting' ? html`${icon('clock')} closes in ${until(b.voting_ends)}` : b.status === 'gathering' ? `${b.signatures}/${d.threshold} signatures` : fmtDate(b.created_at)}</span></div>
    <h3 style="margin:8px 0 4px">${b.title}</h3><p class="small muted" style="margin:0 0 8px">${b.summary}</p>
    ${['voting', 'passed', 'failed', 'enacted', 'vetoed'].includes(b.status) ? html`<div class="vote-bar">${voteBar(b)}</div><div class="tiny muted" style="margin-top:4px">Yes ${b.yes} · No ${b.no} · Abstain ${b.abstain}</div>` : ''}
    <div class="tiny faint" style="margin-top:6px">Sponsored by @${b.sponsor?.username}</div></a>`)}</div>` : empty('No bills here yet.', 'vote', isCitizen() ? html`<p><a class="btn" href="#/laws/bills/new">Propose the first one</a></p>` : '')}`);
}

export async function billNew(view) {
  if (!isCitizen()) return go('/laws/bills');
  const depts = await api.get('/api/gov/departments');
  mount(view, html`${crumbs(['Laws', '#/laws'], ['Bills', '#/laws/bills'], ['Propose'])}<h1>Propose a bill</h1>
  <p class="muted">Tabling a bill requires a passport check. You sign it automatically as its first sponsor.</p>
  <form class="card pad form" data-form style="max-width:860px">
    <label class="field"><span>Short title</span><input class="input" name="title" required minlength="8" maxlength="160" placeholder="e.g. Marketplace Fee Transparency Act"></label>
    <label class="field"><span>Summary</span><textarea class="input" name="summary" required minlength="20" maxlength="600" style="min-height:80px" placeholder="What does it do and why?"></textarea></label>
    <label class="field"><span>Responsible department</span><select class="input" name="departmentId"><option value="">None</option>${depts.map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select></label>
    <label class="field"><span>Full text</span><textarea class="input" name="body" required minlength="50" style="min-height:320px" placeholder="## 1. Purpose&#10;…&#10;&#10;## 2. Provisions&#10;1. …"></textarea><small>Use ## headings and numbered clauses.</small></label>
    <div><button class="btn primary" type="submit">${icon('columns')} Table the bill</button></div></form>`);
  handleForm(view.querySelector('[data-form]'), async (d) => { const r = await api.post('/api/gov/bills', d); toast('Bill tabled', 'ok'); go(`/laws/bills/${r.id}`); });
}

export async function bill(view, { id }) {
  const b = await api.get(`/api/gov/bills/${id}`);
  const total = b.yes + b.no + b.abstain;
  const mine = b.sponsor?.id === user()?.id;
  mount(view, html`${crumbs(['Laws', '#/laws'], ['Bills', '#/laws/bills'], [`Bill #${b.id}`])}
  <div class="split"><article class="card pad-lg" style="padding:clamp(20px,4vw,44px)">
    <div class="row tight">${statusBadge(b.status)}<span class="small faint">Bill #${b.id} · tabled ${fmtDate(b.created_at)}</span></div>
    <h1 style="margin-top:12px">${b.title}</h1><p class="muted">${b.summary}</p>
    <div class="small">Sponsor: ${userLink(b.sponsor)}${b.department ? html` · <a href="#/government/${b.department.slug}">${b.department.name}</a>` : ''}</div><hr>
    <div class="prose">${md(b.body)}</div></article>
  <aside class="stack">
    ${b.status === 'gathering' ? html`<div class="card pad stack tight"><h3 style="margin:0">Sponsor signatures</h3>
      <div class="bar"><i style="width:${Math.min(100, (b.signatures / b.threshold) * 100)}%;background:var(--gold)"></i></div>
      <div class="small muted">${b.signatures} of ${b.threshold} needed to open the national vote</div>
      ${isCitizen() ? (b.signed ? html`<div class="callout ok small">${icon('check')}<div>You have signed this bill.</div></div>` : html`<button class="btn primary" data-sign>${icon('edit')} Sign as sponsor</button>`) : html`<a class="small" href="#/join">Become a citizen to sign</a>`}
      ${mine ? html`<button class="btn ghost sm danger" data-withdraw>Withdraw bill</button>` : ''}</div>` : ''}
    ${['voting', 'passed', 'failed', 'enacted', 'vetoed'].includes(b.status) ? html`<div class="card pad stack tight"><h3 style="margin:0">National vote</h3>
      ${b.status === 'voting' ? html`<div class="small muted">${icon('clock')} Closes ${fmtDateTime(b.voting_ends)} (${until(b.voting_ends)})</div>` : ''}
      <div class="vote-bar" style="height:14px">${voteBar(b)}</div>
      ${describe([['Yes', html`<b style="color:var(--ok)">${b.yes}</b>`], ['No', html`<b style="color:var(--bad)">${b.no}</b>`], ['Abstain', b.abstain], ['Turnout', total]])}
      ${b.myVote ? html`<div class="callout ok small">${icon('check')}<div>You voted <b>${b.myVote.choice}</b> on ${fmtDateTime(b.myVote.ts)}. Your vote is signed with your .access key.</div></div>`
        : b.status === 'voting' && isCitizen() ? html`<div class="grid g3"><button class="btn" data-vote="yes" style="color:var(--ok)">Yes</button><button class="btn" data-vote="no" style="color:var(--bad)">No</button><button class="btn" data-vote="abstain">Abstain</button></div><div class="tiny muted">Voting requires your .access key.</div>` : ''}
      ${b.status === 'passed' && isAdmin() ? html`<hr style="margin:8px 0"><b>Head of State</b><div class="row"><button class="btn primary" data-assent>Give assent</button><button class="btn danger" data-veto>Veto</button></div>` : ''}
      ${b.status === 'passed' && !isAdmin() ? html`<div class="small muted">Passed — awaiting assent from the Head of State.</div>` : ''}
      ${b.law_id ? html`<a class="btn" href="#/laws/${b.law_id}">${icon('scale')} Read the enacted Act</a>` : ''}</div>` : ''}
  </aside></div>`);

  view.querySelector('[data-sign]')?.addEventListener('click', async () => { await api.post(`/api/gov/bills/${id}/sign`); toast('Signed', 'ok'); bill(view, { id }); });
  view.querySelector('[data-withdraw]')?.addEventListener('click', async () => {
    if (await confirmBox('Withdraw this bill?', 'It will no longer gather signatures.', { danger: true, okLabel: 'Withdraw' })) { await api.post(`/api/gov/bills/${id}/withdraw`); bill(view, { id }); }
  });
  view.querySelectorAll('[data-vote]').forEach((btn) => btn.addEventListener('click', async () => {
    const params = { billId: Number(id), choice: btn.dataset.vote };
    const ok = await accessOp({
      op: 'bill.vote', params, title: `Vote ${params.choice.toUpperCase()} on Bill #${id}`,
      summary: html`You are casting a <b>${params.choice}</b> vote on <b>${b.title}</b>. Votes are final and signed with your key.`,
      submit: (auth) => api.post(`/api/gov/bills/${id}/vote`, { params, auth }),
    });
    if (ok) { toast('Vote cast ✓', 'ok'); bill(view, { id }); }
  }));
  view.querySelector('[data-assent]')?.addEventListener('click', async () => {
    if (await confirmBox('Give assent?', 'The bill becomes an Act and enters the statute book immediately.', { okLabel: 'Give assent' })) { await api.post(`/api/gov/bills/${id}/assent`, { decision: 'assent' }); toast('Enacted', 'ok'); bill(view, { id }); }
  });
  view.querySelector('[data-veto]')?.addEventListener('click', async () => {
    const reason = await promptBox('Veto — reasons for the Gazette', { label: 'Reasons (published)', multiline: true, min: 10, okLabel: 'Veto bill' });
    if (reason) { await api.post(`/api/gov/bills/${id}/assent`, { decision: 'veto', reason }); bill(view, { id }); }
  });
}

// ---------------------------------------------------------------- security model explainer
export async function security(view) {
  const [ep, key] = await Promise.all([api.get('/api/secure/epoch'), api.get('/api/server-key')]);
  const n = nation();
  mount(view, html`${crumbs(['Security'])}
  <div class="page-head"><span class="eyebrow">Department of Digital Security</span><h1>How ${n.short} keeps you secure</h1>
    <p>Three levels of identity assurance protect citizens. The more an action matters, the more proof it needs.</p></div>
  <div class="grid g3">
    ${[['user', 'Standard', 'Account name + password', 'Reading, posting in the forum, messaging, browsing your wallet.'],
      ['id', 'Elevated', 'Passport image check', 'Listing items, tabling and signing bills, records requests, editing your profile, confirming deliveries. Lasts 15 minutes.'],
      ['key', 'Ultra-secure', '.access key + rotating server key + account name + password', `Sending ${n.currency.plural}, buying, voting, changing your password, and government appointments.`]]
      .map(([i, t, how, what]) => html`<div class="card pad stack tight"><span class="dept-icon">${icon(i)}</span><h3 style="margin:0">${t}</h3><b class="small">${how}</b><p class="small muted" style="margin:0">${what}</p></div>`)}
  </div>
  <div class="split" style="margin-top:24px"><div class="stack">
    <div class="card pad prose" style="max-width:none">${md(`## The .access key
When your citizenship is approved, **your browser** generates an ECDSA P-256 key pair. The private key is turned into text, encrypted with AES-256-GCM using a key derived from your password (PBKDF2-SHA256, 600,000 rounds), and downloaded as your **.access file**. Only the public key is sent to us, and its fingerprint is printed on your passport.

## An ultra-secure action, step by step
1. You choose the action — for example *send 50 ${n.currency.symbol} to @alex*.
2. You scan your .access file. Your browser decrypts it with your password; **the decrypted text becomes your signing key**. It never leaves your device.
3. The server issues a **challenge**: your account, the action, a hash of its exact details, the current **rotating server key** epoch and a one-time nonce, all sealed with that epoch's key.
4. Your key signs the challenge. You then confirm with your **account name and password**.
5. The server checks the seal (the rotating key must be current or just-previous), that the details hash matches what you are actually doing, that the nonce has not been used, the signature against your public key, and your password. Only then does the action happen.

Because the challenge is bound to the details and to a key that rotates every ${ep.periodSeconds / 60} minutes, a captured signature cannot be replayed, reused for a different amount, or used later.

## Passport image checks
Your passport SVG (or PNG) carries a token signed with the government's Ed25519 key. Uploading it proves you hold your passport; the token must match your account and current passport version, so old or someone else's images are refused.

## One person, one account
Applicants submit an identity document and a live selfie taken while following a random prompt. We store a keyed one-way fingerprint of the document number, so the same document can never back two accounts. Registrars also see flags for matching name and date of birth, shared networks, and similar selfies.

## Tamper-evident ledger
Every ${n.currency.name} movement is appended to a hash chain signed by the Treasury, and citizen-initiated transfers carry the citizen's own signature. Anyone can re-verify the whole chain from Public Records.`)}</div>
  </div><aside class="stack">
    <div class="card pad stack tight"><h4 style="margin:0">Rotating server key</h4>
      <div class="row"><div class="epoch-ring" data-ring></div><div><div class="mono">Epoch ${ep.epoch}</div><div class="small muted">Fingerprint <span class="mono">${ep.fingerprint}</span></div><div class="small muted" data-rot></div></div></div></div>
    <div class="card pad stack tight"><h4 style="margin:0">Government signing key</h4><div class="small muted">${key.algorithm} · fingerprint <span class="mono">${key.fingerprint}</span></div>
      <pre class="keyfile" style="margin:0">${key.publicKey}</pre></div>
  </aside></div>`);
  const ring = view.querySelector('[data-ring]'); const rot = view.querySelector('[data-rot]');
  const tick = () => {
    if (!ring.isConnected) return clearInterval(t);
    const left = ep.rotatesAt - Date.now();
    if (left <= 0) return security(view);
    ring.style.setProperty('--p', 100 - (left / (ep.periodSeconds * 1000)) * 100);
    rot.textContent = `Rotates in ${until(ep.rotatesAt)}`;
  };
  const t = setInterval(tick, 1000); tick();
}
