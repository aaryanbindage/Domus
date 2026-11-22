import { html, mount, icon, fmtDate, fmtDateTime, ago, num, statusBadge, userLink, pager, empty, handleForm, toast, go, qs, avatar, sigilArt, rarityLabel, promptBox, md } from '../ui.js';
import { api } from '../api.js';
import { nation, isCitizen, isOfficial, user } from '../store.js';
import { describe } from '../secure.js';

const crumbs = (...items) => html`<nav class="crumbs"><a href="#/">Home</a><span><a href="#/records">Public Records</a></span>${items.map((l) => html`<span>${l}</span>`)}</nav>`;

export async function hub(view) {
  const n = nation();
  mount(view, html`<nav class="crumbs"><a href="#/">Home</a><span>Public Records</span></nav>
  <div class="page-head"><span class="eyebrow">National Archives</span><h1>Public records</h1><p>Under the Public Records Act, government is open by default. Identity documents, dates of birth, emails and legal names are never published.</p></div>
  <div class="grid g3">${[
    ['users', 'Citizen Registry', '#/records/registry', 'Every citizen’s account, passport number and key fingerprint.'],
    ['ledger', 'Public Ledger', '#/records/ledger', `Every ${n.currency.name} ever minted or moved — hash-chained and signed.`],
    ['news', 'Official Gazette', '#/records/gazette', 'Citizenships, appointments, legislation and notices.'],
    ['coin', 'Treasury', '#/records/treasury', `Supply, rarity distribution and the legendary ${n.currency.plural} register.`],
    ['archive', 'Records Requests', '#/records/requests', 'Ask any department for a record. Answers are public.'],
    ['shield', 'Passport Verification', '#/verify', 'Confirm that a passport is genuine and current.'],
    ['scale', 'Statute Book', '#/laws', 'The Constitution and every Act in force.'],
    ['vote', 'Legislative Record', '#/laws/bills', 'Every bill, its sponsors and the vote tally.'],
  ].map(([i, t, href, d]) => html`<a class="card link pad stack tight" href="${href}"><span class="dept-icon">${icon(i)}</span><b>${t}</b><span class="small muted">${d}</span></a>`)}</div>`);
}

export async function registry(view, _p, query) {
  const page = Number(query.get('page') || 1); const term = query.get('q') || '';
  const d = await api.get(`/api/gov/records/registry${qs({ page, q: term })}`);
  mount(view, html`${crumbs('Citizen Registry')}<div class="page-head"><h1>Citizen Registry</h1><p>${num(d.total)} citizen${d.total === 1 ? '' : 's'} of ${nation().name}.</p></div>
  <form class="row" data-search style="margin-bottom:16px"><input class="input" name="q" value="${term}" placeholder="Name, account or passport number" style="max-width:380px"><button class="btn">${icon('search')} Search</button></form>
  ${d.items.length ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Citizen</th><th>Passport</th><th>Key fingerprint</th><th>Citizen since</th></tr></thead><tbody>
    ${d.items.map((c) => html`<tr><td><div class="row tight" style="flex-wrap:nowrap">${avatar(c.displayName)}<div>${userLink(c)}<div class="tiny muted">@${c.username}</div></div></div></td>
      <td><a class="mono" href="#/verify/${c.passportNo}">${c.passportNo}</a></td><td class="hash">${c.keyId}</td><td class="nowrap">${fmtDate(c.citizenSince)}</td></tr>`)}</tbody></table></div>` : empty('No citizens match.', 'users')}
  ${pager(d.page, d.pages, (p) => `#/records/registry${qs({ page: p, q: term })}`)}`);
  view.querySelector('[data-search]').onsubmit = (e) => { e.preventDefault(); go(`/records/registry${qs({ q: e.target.q.value.trim() })}`); };
}

const TX_LABEL = { mint: 'Mint', transfer: 'Transfer', escrow: 'Escrow lock', escrow_release: 'Escrow release', escrow_refund: 'Escrow refund', exchange_in: 'Mint exchange', exchange_out: 'Mint change' };
export const txBadge = (t) => html`<span class="badge ${t === 'mint' ? 'gold' : t === 'transfer' ? 'blue' : t === 'escrow' ? 'warn' : 'ok'}">${TX_LABEL[t] || t}</span>`;

const party = (name) => (!name || name === 'Treasury' ? html`<span class="muted">Treasury</span>` : html`<a href="#/citizen/${name}">@${name}</a>`);
export async function ledger(view, _p, query) {
  const page = Number(query.get('page') || 1);
  const d = await api.get(`/api/gov/records/ledger${qs({ page })}`);
  mount(view, html`${crumbs('Ledger')}
  <div class="page-head row between"><div><h1>Public ledger</h1><p>${num(d.total)} entries. Each entry contains the hash of the one before it and is signed by the Treasury. Citizen transfers also carry the sender’s .access-key signature.</p></div>
    <div class="row"><button class="btn" data-onchain>${icon('ledger')} Compare with the blockchain</button><button class="btn primary" data-verify>${icon('shield')} Verify entire chain</button></div></div>
  <div data-result></div>
  <div class="card table-wrap"><table class="table"><thead><tr><th>#</th><th>Type</th><th>From → To</th><th class="right">Amount</th><th>Memo</th><th>Hash</th><th>When</th></tr></thead><tbody>
    ${d.items.map((t) => html`<tr><td><a href="#/records/ledger/${t.id}">${t.id}</a></td><td>${txBadge(t.type)}${t.signed ? html` <span title="Signed by sender's .access key">${icon('key')}</span>` : ''}</td>
      <td class="small nowrap">${party(t.from)} → ${party(t.to)}</td>
      <td class="right">${num(t.amount)}</td><td class="small muted">${t.memo}</td><td class="hash">${t.hash.slice(0, 12)}…</td><td class="small nowrap">${ago(t.ts)}</td></tr>`)}</tbody></table></div>
  ${pager(d.page, d.pages, (p) => `#/records/ledger?page=${p}`)}`);
  view.querySelector('[data-onchain]').onclick = async (e) => {
    e.target.disabled = true;
    const r = await api.get('/api/gov/records/chain');
    e.target.disabled = false;
    mount(view.querySelector('[data-result]'), html`<div class="callout ${r.ok ? 'ok' : 'bad'}" style="margin-bottom:16px">${icon(r.ok ? 'check' : 'alert')}<div>
      <b>${r.ok ? `All ${num(r.sigils)} Sigils have the same owner on the blockchain as in this ledger` : 'The ledger and the blockchain disagree'}</b>
      <div class="small">Read from the Sigil contract <span class="mono">${r.contract}</span> on ${r.network} (chain ${r.chainId}). Anyone can query it through <span class="mono">/api/chain/rpc</span>.</div>
      ${r.mismatches.length ? html`<ul class="small">${r.mismatches.map((m) => html`<li>${m.issue || `Sigil #${m.serial}: ledger says ${m.ledger}, chain says ${m.chain}`}</li>`)}</ul>` : ''}</div></div>`);
  };
  view.querySelector('[data-verify]').onclick = async (e) => {
    e.target.disabled = true;
    const r = await api.get('/api/gov/records/ledger/verify');
    e.target.disabled = false;
    mount(view.querySelector('[data-result]'), html`<div class="callout ${r.ok ? 'ok' : 'bad'}" style="margin-bottom:16px">${icon(r.ok ? 'check' : 'alert')}<div>
      <b>${r.ok ? `Chain intact — all ${num(r.entries)} entries verified` : 'Problems found in the chain'}</b>
      <div class="small">Hash links, contents and Treasury signatures were recomputed${r.problems.length ? '' : ', and every citizen signature checked against the registry'}. Head: <span class="mono">${r.head.slice(0, 24)}…</span></div>
      ${r.problems.length ? html`<ul class="small">${r.problems.slice(0, 20).map((p) => html`<li>Entry #${p.id}: ${p.issue}</li>`)}</ul>` : ''}</div></div>`);
  };
}

export async function ledgerEntry(view, { id }) {
  const t = await api.get(`/api/gov/records/ledger/${id}`);
  const params = t.op_params ? JSON.parse(t.op_params) : null;
  mount(view, html`${crumbs(html`<a href="#/records/ledger">Ledger</a>`, `Entry #${t.id}`)}
  <h1>Ledger entry #${t.id}</h1>
  <div class="split"><div class="stack">
    <div class="card pad">${describe([['Type', txBadge(t.type)], ['Time', fmtDateTime(t.ts)], ['From', t.from ? userLink(t.from) : 'Treasury'], ['To', t.to ? userLink(t.to) : 'Treasury reserve'], ['Value', html`<b>${num(t.amount)}</b> ${nation().currency.symbol}`], ['Memo', t.memo || '—'], ['Reference', t.ref || '—'], ['Blockchain transaction', t.chain_tx ? html`${t.chain?.explorer ? html`<a class="mono small" href="${t.chain.explorer}/tx/${t.chain_tx}" target="_blank" rel="noopener">${t.chain_tx}</a>` : html`<span class="mono small" style="word-break:break-all">${t.chain_tx}</span>`}<div class="tiny muted">${t.chain?.network} · chain ${t.chain?.chainId}</div>` : '—']])}</div>
    <div class="card pad stack tight"><h4 style="margin:0">Cryptographic proof</h4>${describe([
      ['Entry hash', html`<span class="hash break">${t.hash}</span>`], ['Previous hash', html`<span class="hash break">${t.prev_hash}</span>`],
      ['Treasury signature', html`<span class="hash break">${t.server_sig}</span>`],
      ...(t.challenge ? [['Signed challenge', html`<span class="hash break">${t.challenge}</span>`], ['Sender signature', html`<span class="hash break">${t.sender_sig}</span>`], ['Signed parameters', html`<code class="break">${JSON.stringify(params)}</code>`], ['Sender public key', html`<span class="hash break">${t.fromKey}</span>`]] : []),
    ])}</div>
  </div><aside class="card pad"><h4>Sigils in this entry</h4><p class="small muted">${num(t.serialCount)} serial${t.serialCount === 1 ? '' : 's'}: <span class="mono">${t.serials.length > 300 ? t.serials.slice(0, 300) + '…' : t.serials}</span></p>
    <div class="tokens">${t.preview.map((s) => html`<div class="token">${sigilArt(s.serial, s.rarity)}#${s.serial}<div>${rarityLabel(s.rarity)}</div></div>`)}</div></aside></div>`);
}

const GAZETTE_KINDS = ['founding', 'citizenship', 'passport', 'appointment', 'legislation', 'notice'];
export async function gazette(view, _p, query) {
  const page = Number(query.get('page') || 1); const kind = query.get('kind') || '';
  const d = await api.get(`/api/gov/records/gazette${qs({ page, kind })}`);
  mount(view, html`${crumbs('Official Gazette')}
  <div class="page-head row between"><div><h1>The Official Gazette</h1><p>The authoritative public record of acts of government.</p></div>${isOfficial() ? html`<button class="btn" data-notice>${icon('plus')} Publish notice</button>` : ''}</div>
  <div class="chips" style="margin-bottom:18px"><a class="chip ${!kind ? 'active' : ''}" href="#/records/gazette">All</a>${GAZETTE_KINDS.map((k) => html`<a class="chip ${k === kind ? 'active' : ''}" href="#/records/gazette?kind=${k}">${k}</a>`)}</div>
  ${d.items.length ? html`<div class="card pad timeline">${d.items.map((g) => html`<div><div class="small muted when">${fmtDate(g.ts)}</div><div class="dot"></div><div><span class="badge">${g.kind}</span> <b>${g.title}</b>${g.body ? html`<div class="small muted">${g.body}</div>` : ''}</div></div>`)}</div>` : empty('Nothing published in this category yet.', 'news')}
  ${pager(d.page, d.pages, (p) => `#/records/gazette${qs({ page: p, kind })}`)}`);
  view.querySelector('[data-notice]')?.addEventListener('click', async () => {
    const title = await promptBox('Publish a Gazette notice', { label: 'Notice title', min: 5 });
    if (!title) return;
    await api.post('/api/gov/records/gazette', { title }); toast('Published', 'ok'); gazette(view, {}, query);
  });
}

export async function treasury(view) {
  const t = await api.get('/api/gov/records/treasury');
  const order = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
  const total = t.tokens || 1;
  const maxDay = Math.max(1, ...t.daily.map((d) => d.volume));
  mount(view, html`${crumbs('Treasury')}
  <div class="page-head"><span class="eyebrow">Treasury &amp; Mint</span><h1>The ${t.currency.name} (${t.currency.symbol})</h1><p>Every ${t.currency.name} is a numbered collectible with a face value set by its rarity. ${num(t.grant)} Sigils are minted per new citizen; the Mint also issues common change when a Sigil is broken.</p></div>
  <div class="grid g4">${[[t.circulating, `${t.currency.symbol} in circulation`], [t.tokens, 'Sigils in existence'], [t.reserveValue, `${t.currency.symbol} in Treasury reserve`], [t.escrow, `${t.currency.symbol} held in escrow`], [t.transactions24h, 'Transactions (24h)'], [t.volume24h, `Volume (24h, ${t.currency.symbol})`], [Math.round((t.circulating / Math.max(1, t.tokens)) * 100) / 100, `Average ${t.currency.symbol} per Sigil`], [t.entries, 'Ledger entries']].map(([v, l]) => html`<div class="card stat"><b>${num(v)}</b><span>${l}</span></div>`)}</div>
  <div class="grid g2" style="margin-top:18px">
    <div class="card pad stack"><h3 style="margin:0">Rarity distribution</h3>
      <div class="bar" style="height:14px">${order.slice().reverse().map((r) => html`<i style="width:${((t.byRarity[r] || 0) / total) * 100}%;background:var(--r-${r})"></i>`)}</div>
      <table class="table"><thead><tr><th>Rarity</th><th class="right">Face value</th><th class="right">Minted</th><th class="right">Share</th></tr></thead><tbody>${order.map((r) => html`<tr><td><div class="row tight" style="flex-wrap:nowrap"><span style="width:28px;display:inline-block">${sigilArt(order.indexOf(r) + 1, r)}</span>${rarityLabel(r)}</div></td><td class="right money">${t.values[r]}</td><td class="right">${num(t.byRarity[r] || 0)}</td><td class="right muted">${(((t.byRarity[r] || 0) / total) * 100).toFixed(2)}%</td></tr>`)}</tbody></table></div>
    <div class="card pad stack"><h3 style="margin:0">Transfer volume, last 30 days</h3>
      ${t.daily.length ? html`<div style="display:flex;align-items:flex-end;gap:3px;height:160px" role="img" aria-label="Daily transfer volume">${t.daily.map((d) => html`<div title="${fmtDate(d.day)}: ${num(d.volume)} ${t.currency.symbol} in ${d.count} tx" style="flex:1;background:var(--accent);border-radius:3px 3px 0 0;height:${Math.max(3, (d.volume / maxDay) * 100)}%"></div>`)}</div>` : empty('No transfers yet.', 'ledger')}
      <h4 style="margin:8px 0 0">Largest holders (by value)</h4>
      <div class="list small">${t.top.map((h, i) => html`<div class="row between" style="padding:6px 0"><span>${i + 1}. <a href="#/citizen/${h.username}">${h.display_name}</a></span><span class="money">${num(h.c)}</span></div>`)}</div></div>
  </div>
  <div class="card" style="margin-top:18px"><div class="card-head"><h3>Legendary register</h3><span class="small muted">${t.legendary.length} shown</span></div>
    ${t.legendary.length ? html`<div class="pad tokens">${t.legendary.map((s) => html`<div class="token">${sigilArt(s.serial, 'legendary')}<b>#${s.serial}</b><div class="muted">${s.username === 'Treasury' ? 'Treasury reserve' : html`<a href="#/citizen/${s.username}">@${s.username}</a>`}</div></div>`)}</div>` : empty('No legendary Sigils minted yet.', 'star')}</div>`);
}

export async function requests(view, _p, query) {
  const page = Number(query.get('page') || 1);
  const [d, depts] = await Promise.all([api.get(`/api/gov/records/requests${qs({ page })}`), api.get('/api/gov/departments')]);
  mount(view, html`${crumbs('Records requests')}
  <div class="page-head"><h1>Public records requests</h1><p>Any citizen may request a record from any department. Requests and responses are public.</p></div>
  <div class="split"><div class="stack">${d.items.length ? d.items.map((r) => html`<div class="card"><div class="card-head"><div><b>${r.subject}</b><div class="tiny muted">#${r.id} · ${r.dept || 'Any department'} · by @${r.requester?.username} · ${fmtDate(r.created_at)}</div></div>${statusBadge(r.status)}</div>
    <div class="pad stack tight"><div class="small">${r.details}</div>
      ${r.response ? html`<div class="callout ${r.status === 'fulfilled' ? 'ok' : 'bad'}"><div><b>Response from ${r.responder?.displayName || 'the department'}</b> · <span class="small">${fmtDate(r.responded_at)}</span><div class="post-body small">${md(r.response)}</div></div></div>` : ''}
      ${r.status === 'open' && isOfficial() ? html`<div class="row"><button class="btn sm primary" data-respond="${r.id}" data-status="fulfilled">Fulfil</button><button class="btn sm danger" data-respond="${r.id}" data-status="denied">Deny</button></div>` : ''}</div></div>`)
    : empty('No requests yet.', 'archive')}${pager(d.page, d.pages, (p) => `#/records/requests?page=${p}`)}</div>
  <aside>${isCitizen() ? html`<form class="card pad form" data-form><h3 style="margin:0">Make a request</h3><p class="small muted" style="margin:0">Requires a passport check.</p>
    <label class="field"><span>Department</span><select class="input" name="departmentId"><option value="">Any</option>${depts.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select></label>
    <label class="field"><span>Subject</span><input class="input" name="subject" required minlength="5" maxlength="160"></label>
    <label class="field"><span>What record do you want?</span><textarea class="input" name="details" required minlength="20" maxlength="4000"></textarea></label>
    <button class="btn primary" type="submit">Submit request</button></form>` : html`<div class="card pad small muted">Citizens can submit requests. <a href="#/join">Become a citizen</a>.</div>`}</aside></div>`);
  const form = view.querySelector('[data-form]');
  if (form) handleForm(form, async (x) => { await api.post('/api/gov/records/requests', x); toast('Request submitted', 'ok'); requests(view, {}, query); });
  view.querySelectorAll('[data-respond]').forEach((b) => b.addEventListener('click', async () => {
    const response = await promptBox(b.dataset.status === 'fulfilled' ? 'Fulfil request' : 'Deny request', { label: 'Public response (the record, or reasons for refusal)', multiline: true, min: 5, okLabel: 'Publish response' });
    if (response) { await api.post(`/api/gov/records/requests/${b.dataset.respond}/respond`, { status: b.dataset.status, response }); toast('Response published', 'ok'); requests(view, {}, query); }
  }));
}

export async function verify(view, { pn } = {}) {
  let result = null;
  if (pn) result = await api.get(`/api/gov/verify/${encodeURIComponent(pn)}`);
  mount(view, html`${crumbs('Passport verification')}
  <div style="max-width:640px;margin:0 auto" class="stack">
    <div class="center"><span class="dept-icon" style="margin:0 auto 10px;width:56px;height:56px">${icon('shield')}</span><h1>Verify a passport</h1><p class="muted">Enter a passport number — or upload a passport image to check its embedded government signature.</p></div>
    <form class="row" data-form><input class="input grow mono" name="pn" placeholder="e.g. VR1234567" value="${pn || ''}" required style="text-transform:uppercase"><button class="btn primary">${icon('search')} Look up</button></form>
    <label class="dropzone" data-drop>${icon('upload')}<strong>Or check a passport image</strong><span class="small">SVG or PNG — read entirely in your browser</span><input type="file" accept=".svg,.png" hidden></label>
    <div data-out>${result ? verdict(result) : ''}</div>
  </div>`);
  view.querySelector('[data-form]').onsubmit = (e) => { e.preventDefault(); go(`/verify/${e.target.pn.value.trim().toUpperCase()}`); };
  view.querySelector('[data-drop] input').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const token = await extractToken(f);
    if (!token) return mount(view.querySelector('[data-out]'), html`<div class="callout bad">${icon('alert')}<div><b>No government security token found in this image.</b> It is not a genuine passport file.</div></div>`);
    let p; try { p = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))); } catch { p = {}; }
    const r = await api.get(`/api/gov/verify/${encodeURIComponent(p.pn || 'X')}?token=${encodeURIComponent(token)}`);
    mount(view.querySelector('[data-out]'), verdict(r));
  };
}
async function extractToken(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const dv = new DataView(buf.buffer); let off = 8;
    while (off + 12 <= buf.length) {
      const len = dv.getUint32(off); const type = String.fromCharCode(...buf.subarray(off + 4, off + 8));
      if (type === 'tEXt') { const s = new TextDecoder('latin1').decode(buf.subarray(off + 8, off + 8 + len)); const [k, v] = s.split('\0'); if (k === 'nation-passport') return v; }
      if (type === 'IEND') break; off += 12 + len;
    }
    return null;
  }
  return new TextDecoder().decode(buf).match(/<metadata[^>]*id="nation-passport"[^>]*>([A-Za-z0-9_.-]+)<\/metadata>/)?.[1] || null;
}
function verdict(r) {
  if (!r.passportNo) return html`<div class="callout bad">${icon('x')}<div><b>Not found.</b> ${r.reason}</div></div>`;
  const tokenMsg = { authentic: ['ok', 'The image’s government signature is authentic and current.'], forged: ['bad', 'The image’s signature is INVALID — this image is forged or altered.'], mismatch: ['bad', 'The image’s signature is for a different passport number.'], superseded: ['warn', 'Authentic, but superseded by a reissued passport — this image is no longer valid.'] }[r.tokenCheck];
  return html`<div class="card pad stack">
    <div class="row">${avatar(r.displayName, 'lg')}<div><h3 style="margin:0">${r.displayName}</h3><a href="#/citizen/${r.username}">@${r.username}</a></div><span class="grow"></span>${r.valid ? html`<span class="badge ok">${icon('check')} Valid passport</span>` : html`<span class="badge bad">Not valid (${r.status})</span>`}</div>
    ${tokenMsg ? html`<div class="callout ${tokenMsg[0]}">${icon(tokenMsg[0] === 'ok' ? 'check' : 'alert')}<div>${tokenMsg[1]}</div></div>` : ''}
    ${describe([['Passport no.', html`<span class="mono">${r.passportNo}</span>`], ['Issued', fmtDate(r.issuedAt)], ['Version', `v${r.version}`], ['Holder key fingerprint', html`<span class="mono">${r.keyId}</span>`]])}</div>`;
}

export async function citizen(view, { username }) {
  const c = await api.get(`/api/gov/citizens/${encodeURIComponent(username)}`);
  const rt = c.stats.rating;
  mount(view, html`<nav class="crumbs"><a href="#/">Home</a><span><a href="#/records/registry">Registry</a></span><span>@${c.username}</span></nav>
  <div class="card pad-lg row" style="padding:28px;margin-bottom:20px">${avatar(c.displayName, 'lg')}<div class="grow"><h1 style="margin:0">${c.displayName}</h1>
    <div class="muted">@${c.username} · Citizen since ${fmtDate(c.citizenSince)} ${c.status === 'suspended' ? html`<span class="badge bad">Suspended</span>` : ''}</div>
    ${c.role !== 'member' ? html`<div style="margin-top:6px"><span class="badge official">${c.officialTitle || 'Official'}</span>${c.department ? html` <a class="small" href="#/government/${c.department.slug}">${c.department.name}</a>` : ''}</div>` : ''}</div>
    <div class="row">${user() && user().username !== c.username && isCitizen() ? html`<a class="btn" href="#/wallet/send?to=${c.username}">${icon('send')} Send ${nation().currency.plural}</a>` : ''}<a class="btn" href="#/market/seller/${c.username}">${icon('store')} Shop</a></div></div>
  <div class="split"><div class="stack">
    ${c.bio ? html`<div class="card pad"><h3>About</h3><p style="margin:0">${c.bio}</p></div>` : ''}
    <div class="card"><div class="card-head"><h3>Recent forum threads</h3></div>${c.threads.length ? html`<div class="list">${c.threads.map((t) => html`<a class="list-item" href="#/forum/t/${t.id}"><b class="grow">${t.title}</b><span class="small faint">${ago(t.created_at)}</span></a>`)}</div>` : empty('No threads yet.', 'chat')}</div>
  </div><aside class="card pad">${describe([['Passport', html`<a class="mono" href="#/verify/${c.passportNo}">${c.passportNo}</a>`], ['Key fingerprint', html`<span class="mono">${c.keyId}</span>`], ['Forum posts', num(c.stats.posts)], ['Active listings', num(c.stats.listings)], ['Completed sales', num(c.stats.sales)], ['Seller rating', rt.n ? html`<span class="stars">★</span> ${rt.a.toFixed(1)} (${rt.n})` : '—'], ['Bills sponsored', num(c.stats.bills)]])}
    <hr><a class="small" href="#/records/ledger">View on the public ledger</a></aside></div>`);
}
