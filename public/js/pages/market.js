import { html, mount, icon, num, ago, fmtDate, fmtDateTime, pager, empty, handleForm, toast, go, qs, statusBadge, titleCase, money, avatar, confirmBox, promptBox, md } from '../ui.js';
import { api } from '../api.js';
import { user, nation, isCitizen, isOfficial, refreshMe } from '../store.js';
import { accessOp, describe } from '../secure.js';

let META = null;
const meta = async () => (META ||= await api.get('/api/market/meta'));
const img = (name) => `/api/market/images/${name}`;
const thumb = (l) => (l.images?.length ? html`<img src="${img(l.images[0])}" alt="" loading="lazy">` : icon('package'));
const stars = (r) => html`<span class="stars">${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))}</span>`;
const card = (l) => html`<a class="card link listing-card" href="#/market/l/${l.id}"><div class="thumb">${thumb(l)}</div><div class="body">
  <span class="title">${l.title}</span><div class="row between"><b>${money(l.price)}</b>${l.status === 'sold_out' ? html`<span class="badge">Sold out</span>` : html`<span class="tiny muted">${titleCase(l.delivery)}</span>`}</div>
  ${l.seller ? html`<span class="tiny muted">@${l.seller} · ${ago(l.created_at)}</span>` : ''}</div></a>`;

export async function browse(view, _p, query) {
  const m = await meta();
  const f = { q: query.get('q') || '', category: query.get('category') || '', sort: query.get('sort') || 'new', min: query.get('min') || '', max: query.get('max') || '', page: Number(query.get('page') || 1) };
  const d = await api.get(`/api/market/listings${qs(f)}`);
  const n = nation();
  mount(view, html`
  <section class="hero market-hero" style="padding:clamp(22px,4vw,40px)"><span class="eyebrow">${n.short} Market</span><h1 style="max-width:none">Buy &amp; sell in ${n.currency.plural}</h1>
    <p>Every buyer and seller is a verified citizen. Payments are signed with your .access key and held in escrow until you confirm delivery.</p>
    <form class="row" data-search style="margin-top:14px;max-width:640px"><input class="input grow" name="q" value="${f.q}" placeholder="Search the marketplace…" style="border:0">
      <button class="btn gold">${icon('search')} Search</button></form>
    ${isCitizen() ? html`<a class="btn" href="#/market/sell" style="margin-top:12px;background:transparent;color:#fff;border-color:rgba(255,255,255,.4)">${icon('plus')} List an item</a>` : ''}</section>
  <div class="split left" style="margin-top:22px">
    <aside class="card pad stack" style="position:sticky;top:84px">
      <div><b class="small">Category</b><div class="stack tight" style="margin-top:8px">
        <a class="small ${!f.category ? '' : 'muted'}" href="#/market${qs({ ...f, category: '', page: '' })}" style="${!f.category ? 'font-weight:700' : ''}">All categories</a>
        ${m.categories.map((c) => html`<a class="small ${c === f.category ? '' : 'muted'}" style="text-transform:capitalize;${c === f.category ? 'font-weight:700' : ''}" href="#/market${qs({ ...f, category: c, page: '' })}">${c}</a>`)}</div></div>
      <form class="stack tight" data-price><b class="small">Price (${n.currency.symbol})</b><div class="row tight" style="flex-wrap:nowrap"><input class="input" name="min" type="number" min="0" placeholder="Min" value="${f.min}"><input class="input" name="max" type="number" min="0" placeholder="Max" value="${f.max}"></div><button class="btn sm">Apply</button></form>
      <label class="field"><b class="small">Sort by</b><select class="input" data-sort>${[['new', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['popular', 'Most viewed']].map(([v, l]) => html`<option value="${v}" ${v === f.sort ? 'selected' : ''}>${l}</option>`)}</select></label>
    </aside>
    <div><div class="row between" style="margin-bottom:12px"><span class="muted small">${num(d.total)} listing${d.total === 1 ? '' : 's'}${f.category ? ` in ${f.category}` : ''}${f.q ? ` matching “${f.q}”` : ''}</span></div>
      ${d.items.length ? html`<div class="grid auto" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${d.items.map(card)}</div>` : empty('Nothing listed here yet.', 'store', isCitizen() ? html`<p><a class="btn primary" href="#/market/sell">Be the first to list something</a></p>` : '')}
      ${pager(d.page, d.pages, (p) => `#/market${qs({ ...f, page: p })}`)}</div>
  </div>`);
  view.querySelector('[data-search]').onsubmit = (e) => { e.preventDefault(); go(`/market${qs({ ...f, q: e.target.q.value.trim(), page: '' })}`); };
  view.querySelector('[data-price]').onsubmit = (e) => { e.preventDefault(); go(`/market${qs({ ...f, min: e.target.min.value, max: e.target.max.value, page: '' })}`); };
  view.querySelector('[data-sort]').onchange = (e) => go(`/market${qs({ ...f, sort: e.target.value, page: '' })}`);
}

export async function sell(view) {
  if (!isCitizen()) return go('/apply');
  const m = await meta();
  const c = nation().currency;
  mount(view, html`<nav class="crumbs"><a href="#/market">Market</a><span>Sell</span></nav>
  <div style="max-width:820px;margin:0 auto"><h1>List an item</h1><p class="muted">Listing requires a passport check. Buyers pay into escrow; you’re paid when they confirm receipt.</p>
  <form class="card pad form" data-form>
    <label class="field"><span>Title</span><input class="input" name="title" required minlength="4" maxlength="100"></label>
    <label class="field"><span>Description</span><textarea class="input" name="description" required minlength="10" maxlength="5000" style="min-height:160px"></textarea></label>
    <div class="grid g3">
      <label class="field"><span>Category</span><select class="input" name="category">${m.categories.map((x) => html`<option value="${x}">${titleCase(x)}</option>`)}</select></label>
      <label class="field"><span>Condition</span><select class="input" name="condition">${m.conditions.map((x) => html`<option value="${x}">${titleCase(x)}</option>`)}</select></label>
      <label class="field"><span>Delivery</span><select class="input" name="delivery">${m.delivery.map((x) => html`<option value="${x}">${titleCase(x)}</option>`)}</select></label>
      <label class="field"><span>Price (${c.symbol})</span><input class="input" name="price" type="number" min="1" required></label>
      <label class="field"><span>Quantity</span><input class="input" name="quantity" type="number" min="1" value="1" required></label>
    </div>
    <div class="field"><span>Photos (up to 4)</span><label class="dropzone" data-drop>${icon('camera')}<strong>Add photos</strong><span class="small">JPEG, PNG, WebP or GIF · 5 MB each</span><input type="file" name="images" accept="image/*" multiple hidden></label><div class="row" data-previews></div></div>
    <label class="check"><input type="checkbox" required> This listing is honest and lawful under the Marketplace Commerce Act.</label>
    <div><button class="btn primary lg" type="submit">${icon('store')} Publish listing</button></div></form></div>`);
  const form = view.querySelector('[data-form]');
  form.images.onchange = () => {
    const files = [...form.images.files].slice(0, 4);
    mount(view.querySelector('[data-previews]'), files.map((f) => html`<img src="${URL.createObjectURL(f)}" style="width:90px;height:70px;object-fit:cover;border-radius:6px" alt="">`));
    view.querySelector('[data-drop]').classList.toggle('has', files.length > 0);
  };
  handleForm(form, async () => {
    const fd = new FormData(form);
    fd.delete('images');
    [...form.images.files].slice(0, 4).forEach((f) => fd.append('images', f));
    const r = await api.post('/api/market/listings', fd);
    toast('Listing published', 'ok'); go(`/market/l/${r.id}`);
  });
}

export async function listing(view, { id }) {
  const l = await api.get(`/api/market/listings/${id}`);
  const c = nation().currency;
  const me = user();
  mount(view, html`<nav class="crumbs"><a href="#/market">Market</a><span><a href="#/market?category=${l.category}" style="text-transform:capitalize">${l.category}</a></span><span>${l.title}</span></nav>
  <div class="grid g2" style="align-items:start;gap:28px">
    <div class="gallery"><div class="main" data-main>${l.images.length ? html`<img src="${img(l.images[0])}" alt="${l.title}">` : icon('package')}</div>
      ${l.images.length > 1 ? html`<div class="thumbs">${l.images.map((x, i) => html`<img src="${img(x)}" data-img="${x}" class="${i === 0 ? 'active' : ''}" alt="">`)}</div>` : ''}</div>
    <div class="stack">
      <div><div class="row tight">${statusBadge(l.status)}<span class="badge">${titleCase(l.item_condition)}</span><span class="badge">${titleCase(l.delivery)}</span></div>
        <h1 style="margin:10px 0 6px">${l.title}</h1><div style="font-size:1.8rem">${money(l.price)}</div>
        <div class="small muted">${l.quantity} available · ${num(l.views)} views · listed ${fmtDate(l.created_at)}</div></div>
      ${l.mine ? html`<div class="card pad stack tight"><b>This is your listing</b><div class="row">
          ${l.status === 'active' ? html`<button class="btn sm" data-status="paused">Pause</button>` : ['paused', 'sold_out'].includes(l.status) ? html`<button class="btn sm" data-status="active">Reactivate</button>` : ''}
          <button class="btn sm" data-edit>Edit price / stock</button><button class="btn sm danger" data-status="removed">Remove</button></div></div>`
        : l.status === 'active' ? (isCitizen() ? html`<form class="card pad stack tight" data-buy><div class="row"><label class="field" style="width:110px"><span>Quantity</span><input class="input" name="quantity" type="number" min="1" max="${l.quantity}" value="1"></label>
            <div class="grow"><div class="small muted">Total</div><b data-total>${num(l.price)} ${c.symbol}</b></div></div>
            <button class="btn primary lg block" type="submit">${icon('key')} Buy now — pay into escrow</button>
            <div class="tiny muted">Requires your .access key. Payment is held until you confirm you received the item.</div></form>`
          : html`<div class="card pad small">${me ? html`<a href="#/apply">Finish your citizenship</a> to buy.` : html`<a href="#/login">Sign in</a> as a citizen to buy.`}</div>`)
        : html`<div class="callout">${icon('info')}<div>This listing is not currently available.</div></div>`}
      <a class="card link pad row" href="#/market/seller/${l.seller.username}">${avatar(l.seller.displayName)}<div class="grow"><b>${l.seller.displayName}</b><div class="small muted">@${l.seller.username} · ${l.seller.sales} sale${l.seller.sales === 1 ? '' : 's'}</div></div>
        ${l.seller.rating ? html`<div class="right">${stars(l.seller.rating)}<div class="tiny muted">${l.seller.rating} (${l.seller.ratings})</div></div>` : html`<span class="tiny muted">No ratings yet</span>`}</a>
      <div class="card pad"><h3>Description</h3><div class="post-body">${md(l.description)}</div></div>
      ${me && !l.mine ? html`<button class="btn ghost sm" data-report style="justify-self:start">${icon('flag')} Report listing</button>` : ''}
    </div></div>
  ${l.more.length ? html`<h2 style="margin-top:32px">More from @${l.seller.username}</h2><div class="grid g4">${l.more.map(card)}</div>` : ''}`);

  view.querySelectorAll('[data-img]').forEach((t) => t.onclick = () => {
    view.querySelector('[data-main] img').src = img(t.dataset.img);
    view.querySelectorAll('[data-img]').forEach((x) => x.classList.toggle('active', x === t));
  });
  view.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => {
    if (b.dataset.status === 'removed' && !(await confirmBox('Remove this listing?', 'Buyers will no longer see it.', { danger: true, okLabel: 'Remove' }))) return;
    await api.patch(`/api/market/listings/${id}`, { status: b.dataset.status }); listing(view, { id });
  });
  view.querySelector('[data-edit]')?.addEventListener('click', async () => {
    const price = await promptBox('New price', { label: `Price in ${c.symbol}`, okLabel: 'Next' }); if (!price) return;
    const quantity = await promptBox('Stock', { label: 'Quantity available', okLabel: 'Save' }); if (quantity == null) return;
    try { await api.patch(`/api/market/listings/${id}`, { price: Number(price), quantity: Number(quantity) }); listing(view, { id }); } catch (e) { toast(e.message, 'bad'); }
  });
  view.querySelector('[data-report]')?.addEventListener('click', async () => {
    const reason = await promptBox('Report listing', { label: 'What is wrong with it?', multiline: true, min: 5 });
    if (reason) { await api.post('/api/forum/report', { kind: 'listing', targetId: l.id, reason }); toast('Reported to the Department of Commerce', 'ok'); }
  });
  const buy = view.querySelector('[data-buy]');
  if (buy) {
    buy.quantity.oninput = () => { view.querySelector('[data-total]').textContent = `${num(l.price * (Number(buy.quantity.value) || 0))} ${c.symbol}`; };
    buy.onsubmit = async (e) => {
      e.preventDefault();
      const quantity = Number(buy.quantity.value);
      const params = { listingId: l.id, quantity, unitPrice: l.price };
      const r = await accessOp({
        op: 'market.buy', params, title: `Buy “${l.title}”`,
        summary: describe([['Seller', `@${l.seller.username}`], ['Quantity', quantity], ['Unit price', `${num(l.price)} ${c.symbol}`], ['Total into escrow', html`<b>${num(l.price * quantity)} ${c.symbol}</b>`]]),
        submit: (auth) => api.post(`/api/market/listings/${l.id}/buy`, { params, auth }),
      });
      if (r) { await refreshMe(); toast('Order placed — payment held in escrow', 'ok'); go(`/market/orders/${r.orderId}`); }
    };
  }
}

export async function orders(view, _p, query) {
  if (!isCitizen()) return go('/apply');
  const role = query.get('role') === 'selling' ? 'selling' : 'buying';
  const list = await api.get(`/api/market/orders?role=${role}`);
  mount(view, html`<nav class="crumbs"><a href="#/market">Market</a><span>Orders</span></nav><h1>My orders</h1>
  <div class="tabs"><a class="${role === 'buying' ? 'active' : ''}" href="#/market/orders">Purchases</a><a class="${role === 'selling' ? 'active' : ''}" href="#/market/orders?role=selling">Sales</a></div>
  ${list.length ? html`<div class="card list">${list.map((o) => html`<a class="list-item" href="#/market/orders/${o.id}">
    <div class="thumb" style="width:64px;height:52px;border-radius:6px;overflow:hidden;background:var(--sunken);display:grid;place-items:center;flex:none">${o.listing ? thumb(o.listing) : ''}</div>
    <div class="grow"><b>${o.listing?.title || 'Listing'}</b><div class="small muted">Order #${o.id} · ${role === 'buying' ? `from @${o.seller.username}` : `to @${o.buyer.username}`} · ${ago(o.updated_at)}</div></div>
    <div class="right">${money(o.total)}<div>${statusBadge(o.status)}</div></div></a>`)}</div>` : empty(role === 'buying' ? 'You have not bought anything yet.' : 'No sales yet.', 'package', html`<p><a class="btn" href="#/market${role === 'selling' ? '/sell' : ''}">${role === 'selling' ? 'List an item' : 'Browse the market'}</a></p>`)}`);
}

const ORDER_STEPS = ['escrow', 'shipped', 'completed'];
export async function order(view, { id }) {
  const o = await api.get(`/api/market/orders/${id}`);
  const me = user();
  const c = nation().currency;
  const stepAt = ORDER_STEPS.indexOf(o.status);
  mount(view, html`<nav class="crumbs"><a href="#/market">Market</a><span><a href="#/market/orders${o.role === 'seller' ? '?role=selling' : ''}">Orders</a></span><span>#${o.id}</span></nav>
  <div class="page-head row between"><div><h1>Order #${o.id}</h1><div class="muted">${o.listing ? html`<a href="#/market/l/${o.listing.id}">${o.listing.title}</a>` : ''} · placed ${fmtDateTime(o.created_at)}</div></div>${statusBadge(o.status)}</div>
  ${stepAt >= 0 ? html`<ol class="steps">${['Paid into escrow', 'Delivered', 'Payment released'].map((s, i) => html`<li class="${i < stepAt ? 'done' : i === stepAt ? (o.status === 'completed' ? 'done' : 'current') : ''}">${s}</li>`)}</ol>` : ''}
  <div class="split"><div class="stack">
    ${o.role === 'buyer' && ['escrow', 'shipped'].includes(o.status) ? html`<div class="card pad stack tight"><b>${o.status === 'shipped' ? 'The seller marked this delivered.' : 'Waiting for the seller to deliver.'}</b>
      <div class="small muted">Only confirm once you have actually received the item — this releases ${num(o.total)} ${c.symbol} to the seller. Confirming requires a passport check.</div>
      <div class="row"><button class="btn primary" data-act="confirm">${icon('check')} I received it — release payment</button><button class="btn danger" data-act="dispute">${icon('alert')} Open a dispute</button></div></div>` : ''}
    ${o.role === 'seller' && o.status === 'escrow' ? html`<div class="card pad stack tight"><b>${num(o.total)} ${c.symbol} is in escrow for you.</b><div class="small muted">Deliver the item, then mark it delivered. You’re paid when the buyer confirms.</div>
      <div class="row"><button class="btn primary" data-act="ship">${icon('package')} Mark as delivered</button><button class="btn" data-act="refund">Cancel &amp; refund</button></div></div>` : ''}
    ${o.role === 'seller' && ['shipped', 'disputed'].includes(o.status) ? html`<div class="card pad row between"><span class="small muted">${o.status === 'disputed' ? 'The buyer opened a dispute. You can refund, or wait for the Department of Commerce to rule.' : 'Waiting for the buyer to confirm receipt.'}</span><button class="btn sm" data-act="refund">Refund buyer</button></div>` : ''}
    ${o.status === 'disputed' && isOfficial() && o.role === 'official' ? html`<div class="card pad stack tight"><b>${icon('scale')} Department of Commerce ruling</b><div class="row"><button class="btn primary" data-resolve="release">Pay the seller</button><button class="btn" data-resolve="refund">Refund the buyer</button></div></div>` : ''}
    ${o.role === 'buyer' && o.status === 'completed' && !o.rating ? html`<form class="card pad form" data-review><b>Rate this seller</b><div class="row">${[5, 4, 3, 2, 1].map((n) => html`<label class="check"><input type="radio" name="rating" value="${n}" ${n === 5 ? 'checked' : ''}> ${'★'.repeat(n)}</label>`)}</div>
      <textarea class="input" name="review" maxlength="1000" placeholder="Optional review" style="min-height:70px"></textarea><div><button class="btn primary sm" type="submit">Submit review</button></div></form>` : ''}
    ${o.rating ? html`<div class="card pad">${stars(o.rating)} <span class="small muted">${o.review || ''}</span></div>` : ''}
    <div class="card"><div class="card-head"><h3>Messages</h3></div>
      <div class="messages">${o.messages.length ? o.messages.map((m) => html`<div class="msg ${m.user_id === me.id ? 'me' : ''}"><div class="tiny muted">@${m.username} · ${ago(m.created_at)}</div>${m.body}</div>`) : html`<div class="small muted">No messages yet.</div>`}</div>
      <form class="row pad" data-msg style="border-top:1px solid var(--border)"><input class="input grow" name="body" required maxlength="2000" placeholder="Write a message…"><button class="btn primary">${icon('send')}</button></form></div>
  </div><aside class="card pad">${describe([['Buyer', html`<a href="#/citizen/${o.buyer.username}">@${o.buyer.username}</a>`], ['Seller', html`<a href="#/citizen/${o.seller.username}">@${o.seller.username}</a>`], ['Quantity', o.quantity], ['Total', money(o.total)], ['Delivery', titleCase(o.listing?.delivery)], ['Delivery note', o.ship_note || '—'], ['Updated', fmtDateTime(o.updated_at)]])}
    <hr><div class="small muted">Escrow movements are recorded on the <a href="#/records/ledger">public ledger</a> with reference order:${o.id}.</div></aside></div>`);

  const reload = () => order(view, { id });
  handleForm(view.querySelector('[data-msg]'), async (d) => { await api.post(`/api/market/orders/${id}/messages`, d); reload(); });
  const review = view.querySelector('[data-review]');
  if (review) handleForm(review, async (d) => { await api.post(`/api/market/orders/${id}/review`, { rating: Number(d.rating), review: d.review }); toast('Thanks for your review', 'ok'); reload(); });
  view.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
    const act = b.dataset.act;
    try {
      if (act === 'confirm') { if (!(await confirmBox('Release payment?', `This sends ${num(o.total)} ${c.symbol} from escrow to @${o.seller.username}. It cannot be undone.`, { okLabel: 'Release payment' }))) return; await api.post(`/api/market/orders/${id}/confirm`); await refreshMe(); toast('Payment released', 'ok'); }
      if (act === 'ship') { const note = await promptBox('Mark as delivered', { label: 'Delivery note for the buyer (tracking number, download link, pickup time…)', multiline: true, okLabel: 'Mark delivered' }); if (note == null) return; await api.post(`/api/market/orders/${id}/ship`, { note }); }
      if (act === 'refund') { if (!(await confirmBox('Refund this order?', 'The buyer gets their Sigils back and the stock returns to your listing.', { danger: true, okLabel: 'Refund' }))) return; await api.post(`/api/market/orders/${id}/refund`); }
      if (act === 'dispute') { const reason = await promptBox('Open a dispute', { label: 'What went wrong?', multiline: true, min: 10, okLabel: 'Open dispute' }); if (!reason) return; await api.post(`/api/market/orders/${id}/dispute`, { reason }); }
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  });
  view.querySelectorAll('[data-resolve]').forEach((b) => b.onclick = async () => {
    const note = await promptBox('Ruling', { label: 'Reasons for the ruling (visible to both parties)', multiline: true, min: 5, okLabel: 'Issue ruling' });
    if (note) { await api.post(`/api/market/orders/${id}/resolve`, { outcome: b.dataset.resolve, note }); reload(); }
  });
}

export async function mine(view) {
  if (!isCitizen()) return go('/apply');
  const d = await api.get(`/api/market/listings?seller=${encodeURIComponent(user().username)}`);
  mount(view, html`<nav class="crumbs"><a href="#/market">Market</a><span>My listings</span></nav>
  <div class="page-head row between"><h1>My listings</h1><a class="btn primary" href="#/market/sell">${icon('plus')} New listing</a></div>
  ${d.items.length ? html`<div class="grid g4">${d.items.map(card)}</div>` : empty('You have no active listings.', 'store')}`);
}

export async function seller(view, { username }) {
  const [s, d] = await Promise.all([api.get(`/api/market/sellers/${encodeURIComponent(username)}`), api.get(`/api/market/listings?seller=${encodeURIComponent(username)}`)]);
  mount(view, html`<nav class="crumbs"><a href="#/market">Market</a><span>@${username}</span></nav>
  <div class="card pad-lg row" style="padding:24px;margin-bottom:20px">${avatar(s.seller.displayName, 'lg')}<div class="grow"><h1 style="margin:0">${s.seller.displayName}</h1><div class="muted">@${s.seller.username} · ${s.seller.sales} completed sale${s.seller.sales === 1 ? '' : 's'}</div></div>
    ${s.seller.rating ? html`<div class="right">${stars(s.seller.rating)}<div class="small muted">${s.seller.rating} from ${s.seller.ratings} review${s.seller.ratings === 1 ? '' : 's'}</div></div>` : ''}<a class="btn" href="#/citizen/${username}">Citizen profile</a></div>
  <h2>Listings</h2>${d.items.length ? html`<div class="grid g4">${d.items.map(card)}</div>` : empty('No listings.', 'store')}
  <h2 style="margin-top:28px">Reviews</h2>${s.reviews.length ? html`<div class="card list">${s.reviews.map((r) => html`<div class="list-item" style="display:block">${stars(r.rating)} <b class="small">${r.title}</b><div class="small">${r.review || ''}</div><div class="tiny muted">@${r.buyer} · ${fmtDate(r.updated_at)}</div></div>`)}</div>` : empty('No reviews yet.', 'star')}`);
}
