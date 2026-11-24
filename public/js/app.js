import { html, mount, icon, toast, num, avatar, go } from './ui.js';
import { api, ApiError } from './api.js';
import { state, refreshMe, onMe, user, nation, isCitizen, isOfficial, elevated } from './store.js';
import { forgetAccessKey } from './secure.js';

// [path pattern, module, export, options]
const ROUTES = [
  ['/', 'home', 'home'],
  ['/join', 'account', 'join'], ['/login', 'account', 'login'], ['/verify-email', 'account', 'verifyEmail'],
  ['/apply', 'account', 'apply'], ['/passport', 'account', 'passport'], ['/settings', 'account', 'settings'],
  ['/news', 'gov', 'newsList'], ['/news/new', 'gov', 'newsNew'], ['/news/:id', 'gov', 'newsView'],
  ['/government', 'gov', 'departments'], ['/government/:slug', 'gov', 'department'],
  ['/laws', 'gov', 'laws'], ['/laws/bills', 'gov', 'bills'], ['/laws/bills/new', 'gov', 'billNew'], ['/laws/bills/:id', 'gov', 'bill'], ['/laws/:id', 'gov', 'law'],
  ['/security', 'gov', 'security'],
  ['/records', 'records', 'hub'], ['/records/registry', 'records', 'registry'], ['/records/ledger', 'records', 'ledger'],
  ['/records/ledger/:id', 'records', 'ledgerEntry'], ['/records/gazette', 'records', 'gazette'], ['/records/treasury', 'records', 'treasury'],
  ['/records/requests', 'records', 'requests'], ['/verify', 'records', 'verify'], ['/verify/:pn', 'records', 'verify'],
  ['/citizen/:username', 'records', 'citizen'],
  ['/forum', 'forum', 'index'], ['/forum/new', 'forum', 'newThread'], ['/forum/c/:slug', 'forum', 'category'], ['/forum/t/:id', 'forum', 'thread'],
  ['/wallet', 'wallet', 'wallet'], ['/wallet/send', 'wallet', 'send'],
  ['/market', 'market', 'browse'], ['/market/sell', 'market', 'sell'], ['/market/l/:id', 'market', 'listing'],
  ['/market/orders', 'market', 'orders'], ['/market/orders/:id', 'market', 'order'], ['/market/mine', 'market', 'mine'],
  ['/market/seller/:username', 'market', 'seller'],
  ['/council', 'offices', 'council'], ['/offices', 'offices', 'offices'],
  ['/admin', 'admin', 'admin'],
].map(([pat, mod, fn]) => {
  const keys = [];
  const re = new RegExp('^' + pat.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys, mod, fn };
});

const modules = {};
const load = (name) => (modules[name] ||= import(`./pages/${name}.js`));

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path: path || '/', query: new URLSearchParams(qs) };
}

// ---------------------------------------------------------------- shell
const GOV_NAV = [['/', 'Home'], ['/news', 'News'], ['/government', 'Government'], ['/council', 'Council'], ['/offices', 'Offices'], ['/laws', 'Laws'], ['/records', 'Public Records'], ['/forum', 'Forum']];
const MARKET_NAV = [['/market', 'Browse'], ['/market/sell', 'Sell'], ['/market/orders', 'My orders'], ['/market/mine', 'My listings']];
let shellMode = null;

function header(market) {
  const u = user();
  const n = nation();
  const nav = market ? MARKET_NAV : GOV_NAV;
  return html`
  <div class="gov-banner"><div class="container">${icon('shield')}<span>An official website of <strong>${n.name}</strong> · Online since ${new Date(n.founded || Date.now()).getFullYear()}</span>
    <span class="grow"></span><a href="#/security" style="color:inherit">How we keep you secure</a></div></div>
  <header class="header ${market ? 'market-header' : ''}"><div class="container">
    <button class="btn ghost sm menu-btn" data-menu aria-label="Menu">${icon('menu')}</button>
    <a class="brand" href="#${market ? '/market' : '/'}"><img src="/img/seal.svg" alt=""><span><b>${market ? `${n.short} Market` : n.name}</b><small>${market ? `Trade in ${n.currency.plural}` : n.motto}</small></span></a>
    <nav class="nav" data-nav>
      ${nav.map(([href, label]) => html`<a href="#${href}" data-href="${href}">${label}</a>`)}
      ${market ? html`<a href="#/" class="">${icon('back')} Government portal</a>` : html`<a href="#/market" class="market-link">${icon('store')} Marketplace</a>`}
    </nav>
    <div class="header-actions">
      ${u ? html`
        ${isCitizen() ? html`<a class="wallet-pill" href="#/wallet" title="Wallet">${icon('coin')} ${num(state.me.wallet?.available)} <span class="small muted">${n.currency.symbol}</span></a>` : ''}
        ${elevated() ? html`<span class="elev" title="Passport verified for this session">${icon('shield')}</span>` : ''}
        <div class="dropdown" data-dd>
          <button class="btn ghost sm" data-dd-btn aria-haspopup="true">${avatar(u.displayName)}<span class="truncate" style="max-width:120px">${u.displayName}</span></button>
          <div class="dropdown-menu">
            <div class="pad" style="padding:8px 10px"><b>${u.displayName}</b><div class="small muted">@${u.username} · ${u.status === 'citizen' ? `Citizen ${u.passportNo}` : 'Applicant'}</div></div>
            <div class="sep"></div>
            ${u.status !== 'citizen' ? html`<a href="#/apply">${icon('id')} Citizenship application</a>` : html`
              <a href="#/passport">${icon('id')} My passport</a><a href="#/wallet">${icon('wallet')} Wallet</a>
              <a href="#/market/orders">${icon('package')} Orders</a><a href="#/citizen/${u.username}">${icon('user')} Public profile</a>`}
            <a href="#/settings">${icon('settings')} Settings &amp; security</a>
            ${isOfficial() ? html`<a href="#/admin">${icon('building')} Government console</a>` : ''}
            <div class="sep"></div>
            <button data-logout>${icon('logout')} Sign out</button>
          </div>
        </div>` : html`<a class="btn ghost sm" href="#/login">Sign in</a><a class="btn primary sm" href="#/join">Become a citizen</a>`}
    </div>
  </div></header>
  ${u && !['citizen', 'suspended'].includes(u.status) ? html`<div class="callout warn" style="border-radius:0;border-width:0 0 1px"><div class="container row">${icon('id')}<span class="grow">${{
    email: 'Verify your email address to continue your citizenship application.',
    documents: 'Next step: submit your identity document and a live selfie.',
    review: 'Your application is being reviewed by the Department of Citizenship.',
    approved: 'Approved! Issue your passport and .access key to become a citizen.',
    rejected: 'Your application was not approved. Review the note and reapply.',
    banned: 'This account has been closed.',
  }[u.status]}</span>${u.status !== 'banned' ? html`<a class="btn sm" href="#${u.status === 'email' ? '/verify-email' : u.status === 'approved' ? '/passport' : '/apply'}">Continue ${icon('arrow')}</a>` : ''}</div></div>` : ''}`;
}

function footer() {
  const n = nation();
  return html`<footer class="footer"><div class="container">
    <div class="cols">
      <div><div class="row" style="margin-bottom:10px"><img src="/img/seal.svg" width="36" height="36" alt=""><b style="color:#fff;font-family:var(--serif);font-size:1.1rem">${n.name}</b></div>
        <p class="small">A sovereign online community of verified people. One person, one citizenship. Currency: the ${n.currency.name} (${n.currency.symbol}).</p></div>
      <div><h4>Government</h4><ul><li><a href="#/government">Departments</a></li><li><a href="#/laws">Constitution &amp; laws</a></li><li><a href="#/laws/bills">Bills &amp; votes</a></li><li><a href="#/news">News</a></li></ul></div>
      <div><h4>Records</h4><ul><li><a href="#/records/registry">Citizen registry</a></li><li><a href="#/records/ledger">Public ledger</a></li><li><a href="#/records/gazette">Official Gazette</a></li><li><a href="#/verify">Verify a passport</a></li></ul></div>
      <div><h4>Citizens</h4><ul><li><a href="#/join">Apply for citizenship</a></li><li><a href="#/forum">Public forum</a></li><li><a href="#/market">Marketplace</a></li><li><a href="#/security">Security model</a></li></ul></div>
    </div>
    <hr style="border-color:rgba(255,255,255,.12)"><div class="row between small"><span>© ${new Date().getFullYear()} ${n.name}. Open records under the Public Records Act.</span><span>Rotating key epoch <span class="mono" data-epoch>${state.me?.epoch?.epoch ?? ''}</span></span></div>
  </div></footer>`;
}

function renderShell(market) {
  const app = document.getElementById('app');
  document.body.classList.toggle('market', market);
  mount(app, html`<div data-header>${header(market)}</div><main id="main"><div class="container" id="view"></div></main>${footer()}`);
  shellMode = market;
  bindHeader();
}
function refreshHeader() {
  const el = document.querySelector('[data-header]');
  if (el) { mount(el, header(shellMode)); bindHeader(); markActive(); }
}
function bindHeader() {
  const root = document.querySelector('[data-header]');
  root.querySelector('[data-menu]')?.addEventListener('click', () => root.querySelector('[data-nav]').classList.toggle('open'));
  const dd = root.querySelector('[data-dd]');
  dd?.querySelector('[data-dd-btn]').addEventListener('click', (e) => { e.stopPropagation(); dd.classList.toggle('open'); });
  root.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await api.post('/api/account/logout'); forgetAccessKey(); await refreshMe(); go('/'); toast('Signed out');
  });
}
document.addEventListener('click', () => document.querySelector('[data-dd].open')?.classList.remove('open'));
function markActive() {
  const { path } = parseHash();
  for (const a of document.querySelectorAll('[data-nav] a[data-href]')) {
    const href = a.dataset.href;
    a.classList.toggle('active', href === path || (href !== '/' && href !== '/market' && path.startsWith(href)) || (href === '/market' && (path === '/market' || path.startsWith('/market/l'))));
  }
}

// ---------------------------------------------------------------- router
let renderSeq = 0;
async function route() {
  const seq = ++renderSeq;
  const { path, query } = parseHash();
  const market = path.startsWith('/market');
  if (shellMode !== market) renderShell(market);
  document.querySelector('[data-nav]')?.classList.remove('open');
  markActive();
  const view = document.getElementById('view');
  const m = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  if (!m) { mount(view, notFound()); return; }
  const params = Object.fromEntries(m.r.keys.map((k, i) => [k, decodeURIComponent(m.m[i + 1])]));
  try {
    const mod = await load(m.r.mod);
    if (seq !== renderSeq) return;
    view.innerHTML = '<div class="empty muted">Loading…</div>';
    await mod[m.r.fn](view, params, query);
    if (seq === renderSeq && !location.hash.includes('#top')) window.scrollTo({ top: 0 });
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e instanceof ApiError && e.status === 401) { go(`/login?next=${encodeURIComponent(path)}`); return; }
    console.error(e);
    mount(view, html`<div class="card pad-lg center" style="max-width:560px;margin:40px auto"><div class="pad">${icon('alert')}<h2>Something went wrong</h2><p class="muted">${e.message}</p>
      ${e?.body?.need === 'citizenship' ? html`<a class="btn primary" href="#/apply">Continue your citizenship application</a>` : html`<a class="btn" href="#/">Return home</a>`}</div></div>`);
  }
  document.title = `${document.querySelector('#view h1')?.textContent?.trim() || 'Portal'} · ${nation().name}`;
}
const notFound = () => html`<div class="empty"><h2>Page not found</h2><p>The page you were looking for does not exist.</p><a class="btn" href="#/">Go home</a></div>`;

onMe(() => refreshHeader());
window.addEventListener('hashchange', route);
setInterval(() => { refreshHeader(); }, 30000);

(async () => {
  try { await refreshMe(); } catch { state.me = { user: null }; }
  route();
})();
