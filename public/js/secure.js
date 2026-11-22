// Step-up identity flows.
//   passportCheck() — standard security: upload passport image (signature checked server-side).
//   accessOp()      — ultra security: scan .access file → decrypt → sign rotating-key challenge
//                     → confirm account name + password → run the operation.
import { api, ApiError, setPassportPrompt } from './api.js';
import { html, mount, modal, icon, toast, esc, until } from './ui.js';
import { state, refreshMe, user } from './store.js';
import { unlockAccessFile, signChallenge, ITERATIONS } from './accesskey.js';
import { aurumWallet, signIntent } from './aurum.js';

// Operations that move Sigils on-chain, and so also need a Aurum wallet signature.
const PAYMENTS = new Set(['wallet.send', 'wallet.break', 'market.buy']);

let rememberedKey = null; // { name, text } — the encrypted file only, never the decrypted key

function dropzone(el, { accept, onFile, label, sub }) {
  mount(el, html`<label class="dropzone" tabindex="0">${icon('upload')}<strong>${label}</strong><span class="small">${sub}</span><input type="file" accept="${accept}" hidden></label>`);
  const zone = el.querySelector('.dropzone');
  const input = el.querySelector('input');
  const take = (file) => {
    if (!file) return;
    zone.classList.add('has');
    zone.querySelector('strong').textContent = file.name;
    zone.querySelector('span').textContent = `${(file.size / 1024).toFixed(1)} KB — click to choose a different file`;
    onFile(file);
  };
  input.onchange = () => take(input.files[0]);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); take(e.dataTransfer.files[0]); });
}

export function passportCheck() {
  return modal({ title: 'Identity check', subtitle: 'Standard secure action', iconName: 'id', iconClass: 'gold' }, (body, close) => {
    let file = null;
    mount(body, html`<div class="stack">
      <p class="muted small" style="margin:0">Upload the passport image (SVG or PNG) you downloaded from your Passport page. Its embedded government signature is checked against your account. This unlocks standard secure actions for 15 minutes.</p>
      <div data-drop></div>
      <div class="row" style="justify-content:space-between"><a href="#/passport" class="small" data-go>Download my passport</a>
      <div class="row"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-ok disabled>${icon('shield')} Verify passport</button></div></div></div>`);
    const ok = body.querySelector('[data-ok]');
    dropzone(body.querySelector('[data-drop]'), { accept: '.svg,.png,image/svg+xml,image/png', label: 'Drop your passport image here', sub: 'or click to browse — passport-XXXX.svg / .png', onFile: (f) => { file = f; ok.disabled = false; } });
    body.querySelector('[data-cancel]').onclick = () => close(false);
    body.querySelector('[data-go]').onclick = () => close(false);
    ok.onclick = async () => {
      ok.disabled = true; ok.textContent = 'Checking signature…';
      try {
        const fd = new FormData(); fd.append('passport', file);
        const r = await api.post('/api/account/passport/check', fd);
        state.me.elevation = { passportUntil: r.passportUntil };
        await refreshMe();
        toast('Passport verified ✓', 'ok');
        close(true);
      } catch (e) { toast(e.message, 'bad'); ok.disabled = false; ok.innerHTML = 'Verify passport'; }
    };
  });
}
setPassportPrompt(passportCheck);

/** Ensure a recent passport check, prompting if needed. Resolves true if elevated. */
export async function requirePassport() {
  if ((state.me?.elevation?.passportUntil || 0) > Date.now() + 5000) return true;
  return passportCheck();
}

/**
 * Authorise one ultra-secure operation and run it.
 *   op, params — exactly what the server will verify; params are shown to the citizen.
 *   submit(auth) — performs the API call with { auth }. Its result is returned.
 */
export function accessOp({ op, params, title, summary, submit }) {
  const u = user();
  return modal({ title, subtitle: 'Ultra-secure action · requires your .access key', iconName: 'key', iconClass: 'gold', dismissable: true }, (body, close) => {
    let keyText = rememberedKey?.text || null;
    mount(body, html`<form class="form" autocomplete="off">
      <div class="secure-summary">${summary}</div>
      <div data-drop></div>
      ${rememberedKey ? html`<div class="callout ok small">${icon('check')}<div>Using <b>${rememberedKey.name}</b> remembered for this tab. <a href="#" data-forget>Use a different file</a></div></div>` : ''}
      <div class="grid g2">
        <label class="field"><span>Account name</span><input class="input" name="username" required autocomplete="username" value="${u?.username || ''}"></label>
        <label class="field"><span>Password</span><input class="input" name="password" type="password" required autocomplete="current-password"></label>
      </div>
      <label class="check"><input type="checkbox" name="remember" ${rememberedKey ? 'checked' : ''}> Remember the encrypted .access file in this tab (cleared when you close it)</label>
      <div class="secure-trace hide" data-trace></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary" type="submit">${icon('lock')} Scan key &amp; authorise</button></div>
    </form>`);
    const form = body.querySelector('form');
    const trace = body.querySelector('[data-trace]');
    const log = (msg, cls = '') => { trace.classList.remove('hide'); const d = document.createElement('div'); d.className = cls; d.textContent = msg; trace.append(d); trace.scrollTop = 1e6; };
    const drop = body.querySelector('[data-drop]');
    const showDrop = () => dropzone(drop, {
      accept: '.access', label: 'Scan your .access key file', sub: 'Drop it here or click to browse. It is decrypted only in this browser.',
      onFile: async (f) => { keyText = await f.text(); drop.dataset.name = f.name; },
    });
    if (!rememberedKey) showDrop();
    body.querySelector('[data-forget]')?.addEventListener('click', (e) => { e.preventDefault(); rememberedKey = null; keyText = null; e.target.closest('.callout').remove(); showDrop(); });
    body.querySelector('[data-cancel]').onclick = () => close(null);
    if (rememberedKey) setTimeout(() => form.password.focus(), 50);

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!keyText) return toast('Choose your .access file first', 'bad');
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      trace.textContent = '';
      try {
        log(`Reading ${drop.dataset.name || rememberedKey?.name || '.access file'}…`);
        log(`Deriving decryption key (PBKDF2-SHA256, ${ITERATIONS.toLocaleString()} rounds)…`);
        const { signingKey, headers, pkcs8 } = await unlockAccessFile(keyText, form.password.value, form.username.value.trim());
        log(`Decrypted ✓  Key-Id ${headers['Key-Id']}`, 'ok');
        if (u?.keyId && headers['Key-Id'] !== u.keyId) throw new Error(`This key (${headers['Key-Id']}) is not the current key for your passport (${u.keyId}). It may have been replaced by a reissue.`);
        let chain = null;
        if (PAYMENTS.has(op)) {
          const w = aurumWallet(pkcs8);
          if (u?.chainAddress && w.address.toLowerCase() !== u.chainAddress.toLowerCase()) throw new Error('This .access key does not open your Aurum wallet');
          const it = await api.post('/api/wallet/chain/intent', { op, params });
          if (Number(it.message.from) !== u.id) throw new Error('The payment to sign is not from your account');
          log(`Aurum wallet ${w.address.slice(0, 10)}… signing on-chain ${it.primaryType === 'Exchange' ? `Mint exchange of Sigil #${it.message.serial}` : `payment of ${it.message.amount} ${state.me?.nation?.currency?.symbol || ''}`} (nonce ${it.message.nonce}, chain ${it.domain.chainId})…`);
          chain = { nonce: it.message.nonce, deadline: it.message.deadline, sig: await signIntent(w, it) };
          log('Signed with your Aurum wallet key (EIP-712, secp256k1) ✓', 'ok');
        }
        const ch = await api.post('/api/secure/challenge', { op, params });
        log(`Server challenge issued under rotating key epoch ${ch.epoch} (fingerprint ${ch.epochInfo.fingerprint}), valid ${until(ch.expiresAt)}`);
        const signature = await signChallenge(signingKey, ch.challenge);
        log(`Challenge signed with your private key (ECDSA P-256) ✓`, 'ok');
        log(PAYMENTS.has(op) ? 'Confirming account name + password; the Treasury relays your signed payment on-chain…' : 'Confirming account name + password and submitting…');
        const result = await submit({ challenge: ch.challenge, signature, username: form.username.value.trim(), password: form.password.value, ...(chain && { chain }) });
        rememberedKey = form.remember.checked ? { name: drop.dataset.name || rememberedKey?.name || 'key.access', text: keyText } : null;
        log('Authorised ✓', 'ok');
        close(result ?? true);
      } catch (err) {
        log(`✗ ${err.message}`, 'bad');
        btn.disabled = false;
        if (!(err instanceof ApiError)) return;
        if (err.body?.need !== 'access') { toast(err.message, 'bad'); }
      }
    };
  });
}

export const forgetAccessKey = () => { rememberedKey = null; };
export const describe = (rows) => html`<dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
export { esc };
