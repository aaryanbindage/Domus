// Tiny view toolkit: auto-escaping html`` templates, icons, formatting, modals, toasts.

export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const render = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(render).join('') : esc(v));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += render(vals[i]); });
  return new Raw(out);
}
export function mount(el, content) { el.innerHTML = render(content); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
/** Delegated events: on(root, 'click', '[data-x]', (e, el) => …) */
export function on(root, type, sel, fn) {
  root.addEventListener(type, (e) => { const el = e.target.closest(sel); if (el && root.contains(el)) fn(e, el); });
}

// ---------------------------------------------------------------- icons (24px stroke)
const P = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 17h3',
  building: 'M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6M9 10h.01M15 10h.01',
  scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
  archive: 'M3 4h18v5H3zM5 9v11h14V9M10 13h4',
  chat: 'M4 5h16v11H9l-5 4z M8 10h8',
  store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0M10 20v-5h4v5',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7M18 14a6 6 0 0 1 4 7',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  id: 'M3 5h18v14H3zM8 10a2 2 0 1 0 0 .01M5.5 16a3 3 0 0 1 5 0M14 9h4M14 13h4',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v10M9.5 9.5c0-1 1-1.8 2.5-1.8s2.5.6 2.5 1.8c0 2.6-5 1.5-5 4.4 0 1.1 1 1.8 2.5 1.8s2.5-.8 2.5-1.8',
  crown: 'M3 18h18M4 15 3 6l5 4 4-6 4 6 5-4-1 9z',
  columns: 'M3 21h18M4 9h16M12 3 3 8h18zM6 9v10M10 9v10M14 9v10M18 9v10',
  gavel: 'M14 4l6 6M11 7l6 6M12.5 5.5l-6 6 3 3 6-6M8 13l-5 5 2 2 5-5M13 21h8',
  megaphone: 'M3 10v4h4l7 5V5L7 10zM18 8a5 5 0 0 1 0 8M7 14l1 6h3l-1-5',
  book: 'M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a2 2 0 0 0-2 2 2 2 0 0 0-2-2H4zM12 5v16',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  plus: 'M12 5v14M5 12h14', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6 6 18',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  key: 'M15 9a3 3 0 1 0 0 .01M3 21l7.5-7.5M13 9a5 5 0 1 1 2 4M7 17l2 2M5 19l2 2',
  upload: 'M12 15V3M7 8l5-5 5 5M4 15v5h16v-5', download: 'M12 3v12M7 10l5 5 5-5M4 15v5h16v-5',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  alert: 'M12 3 2 20h20zM12 10v4M12 17h.01', info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6', back: 'M19 12H5M11 6l-6 6 6 6',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5', pin: 'M9 3h6l-1 6 4 4H6l4-4zM12 13v8',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5', send: 'M3 11l18-8-8 18-2-8z', menu: 'M4 6h16M4 12h16M4 18h16',
  vote: 'M4 13h16v8H4zM9 13V9l3-6 3 6v4M8 17h8', ledger: 'M4 4h16v16H4zM4 9h16M4 14h16M9 4v16',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', package: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
};
export const icon = (name, cls = '') => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.info}"/></svg>`);

// ---------------------------------------------------------------- formatting
export const fmtDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (t) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const units = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [n, u] of units) if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v > 1 ? 's' : ''} ago`; }
  return '';
}
export function until(t) {
  const s = Math.max(0, Math.round((t - Date.now()) / 1000));
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
export const num = (n) => Number(n || 0).toLocaleString();
export const money = (n) => html`<span class="money">${num(n)}</span>`;
export const titleCase = (s) => String(s || '').replace(/_/g, ' ');
const AVATAR_COLORS = ['#1d4e89', '#7a3e9d', '#1f7a4d', '#b4461d', '#8a6a0a', '#2c64ad', '#a8326e', '#3d6b5a'];
export function avatar(name, cls = '') {
  const n = String(name || '?');
  const c = AVATAR_COLORS[[...n].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return html`<span class="avatar ${cls}" style="background:${c}">${n.replace(/^@/, '').slice(0, 2).toUpperCase()}</span>`;
}
export function userLink(u, { badge = true } = {}) {
  if (!u) return html`<span class="muted">—</span>`;
  return html`<a href="#/citizen/${u.username}">${u.displayName || u.display_name || u.username}</a>${badge && u.role && u.role !== 'member' ? html` <span class="badge official">${u.officialTitle || u.official_title || (u.role === 'admin' ? 'Head of State' : 'Official')}</span>` : ''}`;
}
const STATUS_BADGE = {
  voting: 'blue', gathering: 'warn', passed: 'ok', enacted: 'ok', failed: 'bad', vetoed: 'bad', withdrawn: '',
  pending: 'warn', approved: 'ok', rejected: 'bad', banned: 'bad', citizen: 'ok', suspended: 'bad', review: 'warn',
  escrow: 'warn', shipped: 'blue', completed: 'ok', refunded: '', disputed: 'bad', active: 'ok', sold_out: '', paused: 'warn', removed: 'bad',
  open: 'warn', fulfilled: 'ok', denied: 'bad', in_force: 'ok', repealed: 'bad',
  accepted: 'ok', elected: 'ok', 'not elected': 'bad',
};
export const statusBadge = (s) => html`<span class="badge ${STATUS_BADGE[s] ?? ''}">${titleCase(s)}</span>`;

// ---------------------------------------------------------------- safe mini-markdown
export function md(src) {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|#\/)[^)\s]+)\)/g, (_, t, u) => `<a href="${u}"${u.startsWith('http') ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>${t}</a>`);
  const out = [];
  let list = null; let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of String(src || '').split(/\r?\n/)) {
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flush(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue; }
    if ((m = line.match(/^>\s?(.*)/))) { flush(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)/); const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; }
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) { if (list) out.push(`</${list}>`); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`); continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    para.push(line);
  }
  flush();
  return raw(out.join(''));
}

// ---------------------------------------------------------------- toasts + modals
export function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3500);
}

/** Opens a modal. `build(body, close)` fills it. Returns a promise resolved by close(value). */
export function modal({ title, subtitle = '', iconName = 'info', iconClass = '', wide = false, dismissable = true }, build) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    mount(bg, html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mt">
      <div class="modal-head"><div class="modal-icon ${iconClass}">${icon(iconName)}</div>
        <div class="grow"><h3 id="mt">${title}</h3>${subtitle ? html`<div class="muted small">${subtitle}</div>` : ''}</div>
        ${dismissable ? html`<button class="btn ghost sm" data-close aria-label="Close">${icon('x')}</button>` : ''}</div>
      <div class="modal-body"></div></div>`);
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg && dismissable) close(null); });
    bg.querySelector('[data-close]')?.addEventListener('click', () => close(null));
    document.body.append(bg);
    build(bg.querySelector('.modal-body'), close);
    bg.querySelector('input, textarea, select, button.primary')?.focus();
  });
}
export function confirmBox(title, message, { okLabel = 'Confirm', danger = false } = {}) {
  return modal({ title, iconName: danger ? 'alert' : 'info' }, (body, close) => {
    mount(body, html`<p class="muted">${message}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-yes>${okLabel}</button></div>`);
    body.querySelector('[data-no]').onclick = () => close(false);
    body.querySelector('[data-yes]').onclick = () => close(true);
  });
}
export function promptBox(title, { label = '', placeholder = '', multiline = false, okLabel = 'Submit', min = 0 } = {}) {
  return modal({ title, iconName: 'edit' }, (body, close) => {
    mount(body, html`<form class="form"><label class="field"><span>${label}</span>${multiline ? html`<textarea class="input" name="v" placeholder="${placeholder}" required minlength="${min}"></textarea>` : html`<input class="input" name="v" placeholder="${placeholder}" required minlength="${min}">`}</label>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-no>Cancel</button><button class="btn primary">${okLabel}</button></div></form>`);
    body.querySelector('[data-no]').onclick = () => close(null);
    body.querySelector('form').onsubmit = (e) => { e.preventDefault(); close(e.target.v.value.trim()); };
  });
}

export const formData = (form) => Object.fromEntries(new FormData(form).entries());
/** Disable a form's submit button while an async handler runs; report errors as toasts. */
export function handleForm(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit], button:not([type])');
    const label = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = 'Working…'; }
    try { await fn(formData(form), form); } catch (err) { if (err?.message) toast(err.message, 'bad'); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
  });
}

export function pager(pageNo, pages, hrefFor) {
  if (!pages || pages <= 1) return '';
  return html`<nav class="pager">${pageNo > 1 ? html`<a class="btn sm" href="${hrefFor(pageNo - 1)}">${icon('back')} Prev</a>` : ''}<span class="muted small">Page ${pageNo} of ${pages}</span>${pageNo < pages ? html`<a class="btn sm" href="${hrefFor(pageNo + 1)}">Next ${icon('arrow')}</a>` : ''}</nav>`;
}
export const empty = (msg, iconName = 'info', extra = '') => html`<div class="empty">${icon(iconName)}<div>${msg}</div>${extra}</div>`;

// ---------------------------------------------------------------- Sigil token art (deterministic per serial)
const RARITY_COLORS = { common: ['#8f97a3', '#5e6672'], uncommon: ['#3fbf85', '#1d7a51'], rare: ['#5b93f0', '#2353a8'], epic: ['#a873ff', '#6420c9'], legendary: ['#f2c94c', '#b07d0c'] };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function sigilArt(serial, rarity) {
  const [c1, c2] = RARITY_COLORS[rarity] || RARITY_COLORS.common;
  const r = rng(serial * 2654435761);
  const petals = 5 + Math.floor(r() * 8);
  const len = 18 + r() * 10;
  const wid = 4 + r() * 6;
  const rot = r() * 360;
  let shapes = '';
  for (let i = 0; i < petals; i++) shapes += `<ellipse cx="50" cy="${50 - len / 1.6}" rx="${wid.toFixed(1)}" ry="${(len / 1.6).toFixed(1)}" transform="rotate(${(rot + (360 / petals) * i).toFixed(1)} 50 50)" fill="#fff" fill-opacity="${(0.18 + r() * 0.25).toFixed(2)}"/>`;
  const ring = rarity === 'legendary' || rarity === 'epic' ? `<circle cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-opacity=".5" stroke-dasharray="2 3"/>` : '';
  const id = `g${serial}`;
  return raw(`<svg viewBox="0 0 100 100" aria-label="Sigil #${serial} (${rarity})"><defs><radialGradient id="${id}" cx="35%" cy="30%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs>
    <circle cx="50" cy="50" r="48" fill="url(#${id})"/><circle cx="50" cy="50" r="40" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>${ring}${shapes}
    <circle cx="50" cy="50" r="11" fill="${c2}" stroke="#fff" stroke-opacity=".6"/><text x="50" y="54" text-anchor="middle" font-size="10" font-family="Georgia" fill="#fff" font-weight="700">S</text></svg>`);
}
export const rarityLabel = (r) => html`<span class="rarity-${r}" style="font-weight:700;text-transform:capitalize">${r}</span>`;

export const go = (path) => { location.hash = path; };
export const qs = (obj) => { const p = new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };
