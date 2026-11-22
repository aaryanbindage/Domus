import { html, mount, icon, num, ago, fmtDateTime, pager, empty, toast, go, sigilArt, rarityLabel, qs, money } from '../ui.js';
import { api } from '../api.js';
import { user, nation, isCitizen, refreshMe } from '../store.js';
import { accessOp, describe } from '../secure.js';
import { txBadge } from './records.js';

const ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];

export async function wallet(view, _p, query) {
  if (!isCitizen()) return go('/apply');
  const rarity = query.get('rarity') || '';
  const page = Number(query.get('page') || 1);
  const hpage = Number(query.get('h') || 1);
  const [w, tokens, hist] = await Promise.all([api.get('/api/wallet'), api.get(`/api/wallet/tokens${qs({ rarity, page })}`), api.get(`/api/wallet/history?page=${hpage}`)]);
  const c = nation().currency;
  const me = user();
  const total = w.available + w.inEscrow;
  mount(view, html`<nav class="crumbs"><a href="#/">Home</a><span>Wallet</span></nav>
  <div class="page-head row between"><div><span class="eyebrow">Treasury &amp; Mint</span><h1>My wallet</h1></div>
    <div class="row"><a class="btn primary" href="#/wallet/send">${icon('send')} Send ${c.plural}</a><a class="btn" href="#/records/ledger">${icon('ledger')} Public ledger</a></div></div>
  <div class="grid g4">
    <div class="card stat" style="grid-column:span 2;background:linear-gradient(135deg,var(--navy),#1d4e89);color:#fff;border:0"><span style="color:#c9d6ea">Available balance</span><b style="font-size:2.4rem">${num(w.available)} <span style="font-size:1rem;color:var(--gold)">${c.symbol}</span></b><span style="color:#c9d6ea">${num(w.inEscrow)} held in marketplace escrow</span></div>
    ${['legendary', 'epic'].map((r) => html`<div class="card stat"><div class="row between"><b class="rarity-${r}">${num(w.byRarity[r] || 0)}</b><span style="width:40px">${sigilArt(r === 'legendary' ? 7 : 3, r)}</span></div><span style="text-transform:capitalize">${r} Sigils</span></div>`)}
  </div>
  <div class="card pad" style="margin-top:18px"><div class="bar" style="height:12px">${ORDER.slice().reverse().map((r) => html`<i style="width:${((w.byRarity[r] || 0) / (total || 1)) * 100}%;background:var(--r-${r})"></i>`)}</div>
    <div class="row small" style="margin-top:8px">${ORDER.map((r) => html`<span>${rarityLabel(r)} ${num(w.byRarity[r] || 0)}</span>`)}</div></div>

  <div class="split" style="margin-top:18px">
    <div class="card"><div class="card-head"><h3>My collection</h3><span class="small muted">${num(tokens.total)} shown</span></div>
      <div class="pad"><div class="chips" style="margin-bottom:14px"><a class="chip ${!rarity ? 'active' : ''}" href="#/wallet">All</a>${ORDER.map((r) => html`<a class="chip ${r === rarity ? 'active' : ''}" href="#/wallet?rarity=${r}">${r}</a>`)}</div>
      ${tokens.items.length ? html`<div class="tokens">${tokens.items.map((t) => html`<div class="token" title="Sigil #${t.serial} — minted ${fmtDateTime(t.minted_at)}">${t.locked_order ? html`<span class="lock" title="In escrow">${icon('lock')}</span>` : ''}${sigilArt(t.serial, t.rarity)}<b>#${t.serial}</b><div>${rarityLabel(t.rarity)}</div></div>`)}</div>` : empty('No Sigils of this rarity.', 'coin')}
      ${pager(tokens.page, tokens.pages, (p) => `#/wallet${qs({ rarity, page: p })}`)}</div></div>
    <div class="card"><div class="card-head"><h3>History</h3></div>
      ${hist.items.length ? html`<div class="list">${hist.items.map((t) => {
        const incoming = t.to_id === me.id && t.type !== 'escrow';
        const other = incoming ? t.from_user : t.to_user;
        return html`<a class="list-item" href="#/records/ledger/${t.id}"><div class="grow">${txBadge(t.type)} <span class="small">${t.type === 'mint' ? 'Treasury' : other ? `@${other}` : ''}</span><div class="tiny muted">${t.memo} · ${ago(t.ts)}</div></div>
          <b class="mono nowrap" style="color:${incoming ? 'var(--ok)' : 'var(--text)'}">${incoming ? '+' : '−'}${num(t.amount)}</b></a>`;
      })}</div>` : empty('No transactions yet.', 'ledger')}
      ${pager(hist.page, hist.pages, (p) => `#/wallet${qs({ rarity, page, h: p })}`)}</div>
  </div>`);
}

export async function send(view, _p, query) {
  if (!isCitizen()) return go('/apply');
  const w = await api.get('/api/wallet');
  const c = nation().currency;
  let picked = new Set();
  mount(view, html`<nav class="crumbs"><a href="#/">Home</a><span><a href="#/wallet">Wallet</a></span><span>Send</span></nav>
  <div style="max-width:760px;margin:0 auto" class="stack"><div><h1>Send ${c.plural}</h1><p class="muted">Transfers are signed with your .access key and recorded on the public ledger. Available: ${money(w.available)}</p></div>
  <form class="card pad form" data-form>
    <div class="grid g2"><label class="field"><span>Recipient account name</span><input class="input" name="to" required value="${query.get('to') || ''}" placeholder="username" autocomplete="off"><small data-who></small></label>
      <label class="field"><span>Amount (${c.symbol})</span><input class="input" name="amount" type="number" min="1" max="${w.available}" required value="${query.get('amount') || ''}"></label></div>
    <label class="field"><span>Memo (public)</span><input class="input" name="memo" maxlength="140" placeholder="What is it for?"></label>
    <label class="check"><input type="checkbox" name="protectRare" checked> Protect my rare, epic and legendary Sigils (spend commons first)</label>
    <details><summary class="small" style="cursor:pointer">Or choose exactly which Sigils to send…</summary><div data-picker class="pad" style="padding-inline:0"></div></details>
    <button class="btn primary lg" type="submit">${icon('key')} Review &amp; sign transfer</button></form></div>`);
  const form = view.querySelector('[data-form]');
  const who = view.querySelector('[data-who]');
  let lookupTimer;
  form.to.oninput = () => {
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(async () => {
      const name = form.to.value.trim(); if (!name) { who.textContent = ''; return; }
      const r = await api.get(`/api/wallet/lookup/${encodeURIComponent(name)}`);
      who.innerHTML = r.found ? `<span style="color:var(--ok)">✓ ${r.displayName.replace(/</g, '&lt;')} · passport ${r.passportNo}</span>` : '<span style="color:var(--bad)">No citizen with that account name</span>';
    }, 300);
  };
  if (form.to.value) form.to.oninput();
  view.querySelector('details').addEventListener('toggle', async (e) => {
    if (!e.target.open || e.target.dataset.loaded) return;
    e.target.dataset.loaded = 1;
    const box = view.querySelector('[data-picker]');
    const t = await api.get('/api/wallet/tokens?page=1');
    mount(box, html`<p class="small muted">Click Sigils to select them (first 60 shown, rarest first). The amount updates to match.</p><div class="tokens">${t.items.filter((x) => !x.locked_order).map((x) => html`<div class="token selectable" data-serial="${x.serial}">${sigilArt(x.serial, x.rarity)}#${x.serial}<div>${rarityLabel(x.rarity)}</div></div>`)}</div>`);
    box.querySelectorAll('[data-serial]').forEach((el) => el.onclick = () => {
      const s = Number(el.dataset.serial);
      picked.has(s) ? picked.delete(s) : picked.add(s);
      el.classList.toggle('selected', picked.has(s));
      if (picked.size) { form.amount.value = picked.size; form.protectRare.checked = false; }
    });
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount.value);
    const params = { to: form.to.value.trim(), amount, memo: form.memo.value.trim(), protectRare: form.protectRare.checked };
    if (picked.size) {
      if (picked.size !== amount) return toast(`You selected ${picked.size} Sigils but the amount is ${amount}`, 'bad');
      params.serials = [...picked].sort((a, b) => a - b);
    }
    const r = await accessOp({
      op: 'wallet.send', params, title: `Send ${num(amount)} ${c.symbol} to @${params.to}`,
      summary: describe([['To', `@${params.to}`], ['Amount', html`<b>${num(amount)} ${c.symbol}</b>`], ['Memo', params.memo || '—'], ['Which Sigils', params.serials ? `${params.serials.length} hand-picked` : params.protectRare ? 'Commons & uncommons first' : 'Commonest first']]),
      submit: (auth) => api.post('/api/wallet/send', { params, auth }),
    });
    if (r) { await refreshMe(); toast(`Sent ${num(amount)} ${c.symbol} — ledger entry #${r.ledgerId}`, 'ok'); go(`/records/ledger/${r.ledgerId}`); }
  };
}
