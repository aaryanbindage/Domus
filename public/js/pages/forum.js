import { html, mount, icon, md, ago, fmtDate, num, pager, empty, handleForm, toast, go, avatar, confirmBox, promptBox } from '../ui.js';
import { api } from '../api.js';
import { user, isCitizen, isOfficial } from '../store.js';

const crumbs = (...items) => html`<nav class="crumbs"><a href="#/">Home</a><span><a href="#/forum">Forum</a></span>${items.map((l) => html`<span>${l}</span>`)}</nav>`;
const officialBadge = (a) => (a.role && a.role !== 'member' ? html`<span class="badge official">${a.officialTitle || 'Official'}</span>` : '');

export async function index(view) {
  const [cats, recent] = await Promise.all([api.get('/api/forum/categories'), api.get('/api/forum/recent')]);
  mount(view, html`<nav class="crumbs"><a href="#/">Home</a><span>Forum</span></nav>
  <div class="page-head row between"><div><h1>Public forum</h1><p>The town square of the nation. Every poster is a verified citizen — one person, one voice.</p></div>
    ${isCitizen() ? html`<a class="btn primary" href="#/forum/new">${icon('plus')} New thread</a>` : ''}</div>
  <div class="split"><div class="card list">${cats.map((c) => html`<a class="list-item" href="#/forum/c/${c.slug}">
    <span class="dept-icon">${icon(c.official_only ? 'megaphone' : 'chat')}</span>
    <div class="grow"><b>${c.name}</b> ${c.official_only ? html`<span class="badge official">Officials</span>` : ''}<div class="small muted">${c.description}</div>
      ${c.latest ? html`<div class="tiny faint" style="margin-top:4px">Latest: ${c.latest.title} · ${ago(c.latest.at)}</div>` : ''}</div>
    <div class="right small muted nowrap">${num(c.threads)} threads<br>${num(c.posts)} posts</div></a>`)}</div>
  <aside class="stack"><div class="card"><div class="card-head"><h3>Active discussions</h3></div>
    ${recent.length ? html`<div class="list">${recent.map((t) => html`<a class="list-item" href="#/forum/t/${t.id}" style="display:block"><b class="small">${t.title}</b><div class="tiny muted">${t.category} · ${t.post_count} posts · ${ago(t.last_post_at)}</div></a>`)}</div>` : empty('Quiet so far.', 'chat')}</div>
    <div class="card pad small muted">Posting is governed by the <a href="#/laws">Public Forum Conduct Act</a>. Report posts that break it.</div></aside></div>`);
}

export async function category(view, { slug }, query) {
  const page = Number(query.get('page') || 1);
  const d = await api.get(`/api/forum/categories/${slug}?page=${page}`);
  const canPost = isCitizen() && (!d.category.official_only || isOfficial());
  mount(view, html`${crumbs(d.category.name)}
  <div class="page-head row between"><div><h1>${d.category.name}</h1><p>${d.category.description}</p></div>${canPost ? html`<a class="btn primary" href="#/forum/new?c=${d.category.id}">${icon('plus')} New thread</a>` : ''}</div>
  ${d.threads.length ? html`<div class="card list">${d.threads.map((t) => html`<a class="list-item" href="#/forum/t/${t.id}">${avatar(t.author.displayName)}
    <div class="grow"><div class="row tight">${t.pinned ? html`<span class="badge gold">${icon('pin')} Pinned</span>` : ''}${t.locked ? html`<span class="badge">${icon('lock')} Locked</span>` : ''}<b>${t.title}</b></div>
      <div class="tiny muted">by ${t.author.displayName} ${officialBadge(t.author)} · ${fmtDate(t.created_at)}</div></div>
    <div class="right tiny muted nowrap">${t.post_count} post${t.post_count === 1 ? '' : 's'}<br>${ago(t.last_post_at)}</div></a>`)}</div>`
    : empty('No threads yet.', 'chat', canPost ? html`<p><a class="btn" href="#/forum/new?c=${d.category.id}">Start the first one</a></p>` : '')}
  ${pager(d.page, d.pages, (p) => `#/forum/c/${slug}?page=${p}`)}`);
}

export async function newThread(view, _p, query) {
  if (!isCitizen()) return go('/forum');
  const cats = (await api.get('/api/forum/categories')).filter((c) => !c.official_only || isOfficial());
  const pre = Number(query.get('c'));
  mount(view, html`${crumbs('New thread')}<h1>Start a discussion</h1>
  <form class="card pad form" data-form style="max-width:820px">
    <label class="field"><span>Category</span><select class="input" name="categoryId">${cats.map((c) => html`<option value="${c.id}" ${c.id === pre ? 'selected' : ''}>${c.name}</option>`)}</select></label>
    <label class="field"><span>Title</span><input class="input" name="title" required minlength="5" maxlength="140"></label>
    <label class="field"><span>Post</span><textarea class="input" name="body" required minlength="2" style="min-height:220px"></textarea><small>**bold**, *italic*, - lists, > quotes, [links](https://…)</small></label>
    <div><button class="btn primary" type="submit">${icon('send')} Post thread</button></div></form>`);
  handleForm(view.querySelector('[data-form]'), async (d) => { const r = await api.post('/api/forum/threads', d); go(`/forum/t/${r.id}`); });
}

export async function thread(view, { id }, query) {
  const page = Number(query.get('page') || 1);
  const d = await api.get(`/api/forum/threads/${id}?page=${page}`);
  const t = d.thread;
  const canReply = isCitizen() && (!t.locked || isOfficial());
  mount(view, html`${crumbs(html`<a href="#/forum/c/${t.slug}">${t.category}</a>`, t.title)}
  <div class="page-head row between"><div><div class="row tight">${t.pinned ? html`<span class="badge gold">Pinned</span>` : ''}${t.locked ? html`<span class="badge">${icon('lock')} Locked</span>` : ''}${t.deleted ? html`<span class="badge bad">Removed</span>` : ''}</div><h1 style="margin-top:6px">${t.title}</h1></div>
    <div class="row">${isOfficial() ? html`<button class="btn sm" data-mod="pinned">${t.pinned ? 'Unpin' : 'Pin'}</button><button class="btn sm" data-mod="locked">${t.locked ? 'Unlock' : 'Lock'}</button><button class="btn sm danger" data-mod="deleted">${t.deleted ? 'Restore' : 'Remove'}</button>` : ''}
      ${user() ? html`<button class="btn sm ghost" data-report-thread>${icon('flag')} Report</button>` : ''}</div></div>
  <div class="stack">${d.posts.map((p) => html`<div class="card post" id="p${p.id}">
    <div class="who">${avatar(p.author.displayName)}<a href="#/citizen/${p.author.username}"><b>${p.author.displayName}</b></a><span class="muted">@${p.author.username}</span>${officialBadge(p.author)}<span class="tiny faint">Citizen since ${fmtDate(p.author.citizenSince)}</span></div>
    <div class="what"><div class="tiny faint">${ago(p.created_at)}${p.edited_at ? ' · edited' : ''}</div>
      ${p.deleted ? html`<div class="muted small"><em>This post was removed.</em></div>` : html`<div class="post-body" data-body="${p.id}">${md(p.body)}</div>`}
      ${p.deleted ? '' : html`<div class="row tight">
        <button class="btn sm ghost" data-like="${p.id}" ${isCitizen() ? '' : 'disabled'} style="${p.liked ? 'color:var(--bad)' : ''}">${icon('heart')} ${p.likes || ''}</button>
        ${isCitizen() && canReply ? html`<button class="btn sm ghost" data-quote="${p.id}">Quote</button>` : ''}
        ${p.mine ? html`<button class="btn sm ghost" data-edit="${p.id}">${icon('edit')} Edit</button>` : ''}
        ${p.mine || isOfficial() ? html`<button class="btn sm ghost" data-del="${p.id}">${icon('trash')}</button>` : ''}
        ${user() && !p.mine ? html`<button class="btn sm ghost" data-report="${p.id}">${icon('flag')}</button>` : ''}</div>`}
    </div></div>`)}</div>
  ${pager(d.page, d.pages, (p) => `#/forum/t/${id}?page=${p}`)}
  ${canReply ? html`<form class="card pad form" data-reply style="margin-top:20px"><h3 style="margin:0">Reply</h3><textarea class="input" name="body" required minlength="2"></textarea><div><button class="btn primary" type="submit">${icon('send')} Post reply</button></div></form>`
    : !user() ? html`<div class="card pad center small muted" style="margin-top:20px"><a href="#/login">Sign in</a> as a citizen to reply.</div>` : t.locked ? html`<div class="callout" style="margin-top:20px">${icon('lock')}<div>This thread is locked.</div></div>` : ''}`);

  const reload = (pg = page) => thread(view, { id }, new URLSearchParams(`page=${pg}`));
  const reply = view.querySelector('[data-reply]');
  if (reply) handleForm(reply, async (x) => { const r = await api.post(`/api/forum/threads/${id}/posts`, x); go(`/forum/t/${id}?page=${r.pages}`); if (r.pages === page) reload(); });
  view.querySelectorAll('[data-like]').forEach((b) => b.onclick = async () => { await api.post(`/api/forum/posts/${b.dataset.like}/like`); reload(); });
  view.querySelectorAll('[data-quote]').forEach((b) => b.onclick = () => {
    const p = d.posts.find((x) => x.id === Number(b.dataset.quote));
    reply.body.value += `> @${p.author.username}: ${p.body.split('\n')[0].slice(0, 200)}\n\n`; reply.body.focus();
  });
  view.querySelectorAll('[data-edit]').forEach((b) => b.onclick = async () => {
    const p = d.posts.find((x) => x.id === Number(b.dataset.edit));
    const el = view.querySelector(`[data-body="${p.id}"]`);
    mount(el, html`<form class="form"><textarea class="input" name="body">${p.body}</textarea><div class="row"><button class="btn sm primary">Save</button><button type="button" class="btn sm" data-cancel>Cancel</button></div></form>`);
    el.querySelector('[data-cancel]').onclick = () => reload();
    handleForm(el.querySelector('form'), async (x) => { await api.patch(`/api/forum/posts/${p.id}`, x); reload(); });
  });
  view.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirmBox('Remove this post?', 'It will be replaced by a removal notice.', { danger: true, okLabel: 'Remove' })) { await api.del(`/api/forum/posts/${b.dataset.del}`); reload(); } });
  const report = async (kind, targetId) => { const reason = await promptBox('Report to moderators', { label: 'What rule does this break?', multiline: true, min: 5, okLabel: 'Send report' }); if (reason) { await api.post('/api/forum/report', { kind, targetId, reason }); toast('Report sent to moderators', 'ok'); } };
  view.querySelectorAll('[data-report]').forEach((b) => b.onclick = () => report('post', Number(b.dataset.report)));
  view.querySelector('[data-report-thread]')?.addEventListener('click', () => report('thread', Number(id)));
  view.querySelectorAll('[data-mod]').forEach((b) => b.onclick = async () => { const k = b.dataset.mod; await api.post(`/api/forum/threads/${id}/moderate`, { [k]: !t[k] }); reload(); });
}
