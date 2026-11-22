import { html, mount, icon, num, fmtDate, ago, until, statusBadge } from '../ui.js';
import { api } from '../api.js';
import { user, nation, isCitizen } from '../store.js';

const DEPT_ICONS = { crown: 'crown', columns: 'columns', scale: 'scale', id: 'id', coin: 'coin', store: 'store', gavel: 'gavel', shield: 'shield', archive: 'archive', megaphone: 'megaphone', book: 'book', globe: 'globe' };
export const deptIcon = (name) => icon(DEPT_ICONS[name] || 'building');

export async function home(view) {
  const [o, recent] = await Promise.all([api.get('/api/gov/overview'), api.get('/api/forum/recent')]);
  const n = nation();
  const u = user();
  const s = o.stats;
  mount(view, html`
  <section class="hero">
    <img class="seal-bg" src="/img/seal.svg" alt="">
    <span class="eyebrow">${n.motto}</span>
    <h1>Welcome to the ${n.name}</h1>
    <p>A nation that exists online, governed by its citizens. Every citizen is one verified person, holds a signed digital passport and a personal .access key, and receives ${num(n.citizenshipGrant)} ${n.currency.plural} on joining.</p>
    <div class="row" style="margin-top:22px">
      ${!u ? html`<a class="btn gold lg" href="#/join">${icon('id')} Apply for citizenship</a><a class="btn lg" href="#/security" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.35)">How it works</a>`
        : isCitizen() ? html`<a class="btn gold lg" href="#/passport">${icon('id')} My passport</a><a class="btn lg" href="#/market" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.35)">${icon('store')} Marketplace</a>`
        : html`<a class="btn gold lg" href="#/apply">${icon('id')} Continue my application</a>`}
    </div>
  </section>

  <section class="grid g4" style="margin-top:20px">
    ${[[s.citizens, 'Citizens', 'users', '#/records/registry'], [s.lawsInForce, 'Laws in force', 'scale', '#/laws'], [s.billsVoting, 'Bills in national vote', 'vote', '#/laws/bills'], [s.supply, `${n.currency.plural} in circulation`, 'coin', '#/records/treasury']]
      .map(([v, l, i, href]) => html`<a class="card link stat" href="${href}"><div class="row between"><b>${num(v)}</b><span class="dept-icon" style="width:36px;height:36px">${icon(i)}</span></div><span>${l}</span></a>`)}
  </section>

  <section class="split" style="margin-top:28px">
    <div class="stack">
      <div class="card"><div class="card-head"><h3>Latest news</h3><a href="#/news" class="small">All news ${icon('arrow')}</a></div>
        <div class="list">${o.news.map((a) => html`<a class="list-item" href="#/news/${a.id}"><div class="grow"><div class="row tight"><span class="badge blue">${a.category}</span>${a.pinned ? html`<span class="badge gold">${icon('pin')} Pinned</span>` : ''}<span class="small faint">${fmtDate(a.published_at)}</span></div>
          <h4 style="margin:6px 0 4px;font-size:1.05rem">${a.title}</h4><div class="small muted">${a.summary}</div></div></a>`)}</div></div>

      <div class="card"><div class="card-head"><h3>Government services</h3></div><div class="pad grid g3">
        ${[['id', 'Citizenship & passports', '#/apply', 'Apply, download your passport, manage your key'],
          ['vote', 'Propose or vote on a bill', '#/laws/bills', 'Direct democracy — every citizen votes'],
          ['wallet', `Send ${n.currency.plural}`, '#/wallet/send', 'Signed transfers on the public ledger'],
          ['store', 'Sell in the Marketplace', '#/market/sell', 'Escrow-protected trade'],
          ['archive', 'Request a public record', '#/records/requests', 'Open government by default'],
          ['shield', 'Verify a passport', '#/verify', 'Check a passport is genuine']]
          .map(([i, t, href, d]) => html`<a class="card link pad" href="${href}" style="box-shadow:none"><span class="dept-icon" style="margin-bottom:10px">${icon(i)}</span><b>${t}</b><div class="small muted">${d}</div></a>`)}
      </div></div>

      <div class="card"><div class="card-head"><h3>Departments of State</h3><a href="#/government" class="small">All departments ${icon('arrow')}</a></div>
        <div class="pad grid g3">${o.departments.map((d) => html`<a class="row" href="#/government/${d.slug}" style="color:inherit;text-decoration:none"><span class="dept-icon">${deptIcon(d.icon)}</span><span><span class="branch">${d.branch}</span><br><b class="small">${d.short}</b></span></a>`)}</div></div>
    </div>

    <aside class="stack">
      <div class="card"><div class="card-head"><h3>Before the Assembly</h3><a href="#/laws/bills" class="small">Bills</a></div>
        ${o.bills.length ? html`<div class="list">${o.bills.map((b) => html`<a class="list-item" href="#/laws/bills/${b.id}" style="display:block"><div class="row between">${statusBadge(b.status)}${b.status === 'voting' ? html`<span class="small muted">${icon('clock')} ${until(b.voting_ends)}</span>` : ''}</div><b style="display:block;margin-top:6px">${b.title}</b>
          ${b.status === 'voting' ? html`<div class="vote-bar" style="margin-top:8px">${voteBar(b)}</div>` : ''}</a>`)}</div>`
          : html`<div class="empty small">No bills are before the Assembly. <a href="#/laws/bills/new">Propose one</a>.</div>`}</div>

      <div class="card"><div class="card-head"><h3>Official Gazette</h3><a href="#/records/gazette" class="small">All</a></div>
        <div class="list">${o.gazette.map((g) => html`<div class="list-item" style="display:block"><div class="small faint">${ago(g.ts)} · ${g.kind}</div><div class="small"><b>${g.title}</b></div></div>`)}</div></div>

      <div class="card"><div class="card-head"><h3>From the forum</h3><a href="#/forum" class="small">Forum</a></div>
        ${recent.length ? html`<div class="list">${recent.slice(0, 5).map((t) => html`<a class="list-item" href="#/forum/t/${t.id}" style="display:block"><b class="small">${t.title}</b><div class="tiny muted">${t.category} · ${t.post_count} posts · ${ago(t.last_post_at)}</div></a>`)}</div>`
          : html`<div class="empty small">No discussions yet.</div>`}</div>
    </aside>
  </section>`);
}

export function voteBar(b) {
  const t = b.yes + b.no + b.abstain || 1;
  return html`<i class="y" style="width:${(b.yes / t) * 100}%"></i><i class="n" style="width:${(b.no / t) * 100}%"></i><i class="a" style="width:${(b.abstain / t) * 100}%"></i>`;
}
