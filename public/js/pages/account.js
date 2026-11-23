import { html, mount, icon, toast, handleForm, go, fmtDate, fmtDateTime, num, until, confirmBox, modal } from '../ui.js';
import { api } from '../api.js';
import { state, refreshMe, user, nation } from '../store.js';
import { generateKeyPair, sealAccessFile, unlockAccessFile, signChallenge, downloadText, passportSvgToPng } from '../accesskey.js';
import { aurumWallet, linkProof } from '../aurum.js';
import { accessOp, passportCheck, describe } from '../secure.js';

const STEPS = ['Account', 'Email', 'Identity', 'Review', 'Passport'];
const stepIndex = { email: 1, documents: 2, rejected: 2, review: 3, approved: 4, citizen: 5 };
const steps = (status) => html`<ol class="steps">${STEPS.map((s, i) => html`<li class="${i < (stepIndex[status] ?? 0) ? 'done' : i === (stepIndex[status] ?? 0) ? 'current' : ''}">${s}</li>`)}</ol>`;
const narrow = (inner) => html`<div style="max-width:720px;margin:0 auto">${inner}</div>`;

// ---------------------------------------------------------------- sign up / sign in
export async function join(view) {
  if (user()) return go(user().status === 'citizen' ? '/passport' : '/apply');
  const n = nation();
  mount(view, narrow(html`${steps('account')}
  <div class="grid g2" style="align-items:start">
    <div><span class="eyebrow">Citizenship</span><h1>Become a citizen of ${n.short}</h1>
      <p class="muted">Citizenship is open to every real person — but only once. Here is what happens:</p>
      <div class="stack tight small">
        ${[['user', 'Create your account', 'Choose an account name and a strong password.'], ['check', 'Verify your email', 'We send you a six-digit code.'],
          ['camera', 'Prove you are real', 'Photograph an ID document and take a live selfie with a random prompt.'], ['eye', 'Human review', 'The Department of Citizenship checks you are one unique person.'],
          ['key', 'Receive your passport + .access key', `Your browser creates your personal key. You get ${num(n.citizenshipGrant)} ${n.currency.plural}.`]]
          .map(([i, t, d]) => html`<div class="row" style="align-items:flex-start;flex-wrap:nowrap"><span class="dept-icon" style="width:34px;height:34px">${icon(i)}</span><div><b>${t}</b><div class="muted">${d}</div></div></div>`)}
      </div></div>
    <form class="card pad form" data-form>
      <h3>Create your account</h3>
      <label class="field"><span>Account name</span><input class="input" name="username" required minlength="3" maxlength="24" pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}" autocomplete="username"><small>3–24 letters, numbers or _. Public, and used to sign in.</small></label>
      <label class="field"><span>Display name</span><input class="input" name="displayName" required minlength="2" maxlength="40"></label>
      <label class="field"><span>Email</span><input class="input" name="email" type="email" required autocomplete="email"></label>
      <label class="field"><span>Password</span><input class="input" name="password" type="password" required minlength="10" autocomplete="new-password"><small>At least 10 characters with letters and numbers/symbols. It also encrypts your .access key — don’t forget it.</small></label>
      <label class="check"><input type="checkbox" required> <span>I am a real person applying for my only account, and I accept the <a href="#/laws">Constitution</a> and the Citizenship and Identity Act.</span></label>
      <button class="btn primary block lg" type="submit">Create account</button>
      <p class="small muted center" style="margin:0">Already registered? <a href="#/login">Sign in</a></p>
    </form>
  </div>`));
  handleForm(view.querySelector('[data-form]'), async (d) => {
    const r = await api.post('/api/account/register', d);
    await refreshMe();
    if (r.devCode) sessionStorage.setItem('devCode', r.devCode);
    go('/verify-email');
  });
}

export async function login(view, _p, query) {
  const next = query.get('next') || '/';
  if (user()) return go(next);
  mount(view, html`<div style="max-width:420px;margin:30px auto"><form class="card pad-lg form" data-form style="padding:28px">
    <div class="center"><img src="/img/seal.svg" width="56" height="56" alt="" style="margin:0 auto 10px"><h2>Sign in</h2><p class="muted small">Standard sign-in uses your account name and password. Sensitive actions will additionally ask for your passport or .access key.</p></div>
    <label class="field"><span>Account name</span><input class="input" name="username" required autocomplete="username"></label>
    <label class="field"><span>Password</span><input class="input" name="password" type="password" required autocomplete="current-password"></label>
    <button class="btn primary block lg" type="submit">Sign in</button>
    <p class="small muted center" style="margin:0">Not a citizen yet? <a href="#/join">Apply for citizenship</a></p>
  </form></div>`);
  handleForm(view.querySelector('[data-form]'), async (d) => {
    await api.post('/api/account/login', d);
    const me = await refreshMe();
    toast(`Welcome back, ${me.user.displayName}`, 'ok');
    go(me.user.status === 'citizen' ? next : '/apply');
  });
}

export async function verifyEmail(view) {
  const u = user();
  if (!u) return go('/login');
  if (u.emailVerified) return go('/apply');
  const dev = sessionStorage.getItem('devCode');
  mount(view, narrow(html`${steps('email')}<form class="card pad-lg form" data-form style="max-width:460px;margin:0 auto;padding:28px">
    <h2>Check your email</h2><p class="muted">We sent a six-digit code to <b>${u.email}</b>. It expires in 15 minutes.</p>
    ${dev ? html`<div class="callout warn small">${icon('info')}<div><b>Development mode:</b> no mail server is configured, so the code is shown here and in the server console: <code>${dev}</code></div></div>` : ''}
    <label class="field"><span>Verification code</span><input class="input mono" name="code" required inputmode="numeric" pattern="\\d{6}" maxlength="6" style="font-size:1.4rem;letter-spacing:.4em;text-align:center" value="${dev || ''}"></label>
    <button class="btn primary block" type="submit">Verify email</button>
    <button class="btn ghost block" type="button" data-resend>Send a new code</button>
  </form>`));
  handleForm(view.querySelector('[data-form]'), async (d) => {
    await api.post('/api/account/verify-email', d);
    sessionStorage.removeItem('devCode');
    await refreshMe();
    toast('Email verified ✓', 'ok');
    go('/apply');
  });
  view.querySelector('[data-resend]').onclick = async () => {
    try { const r = await api.post('/api/account/resend-code'); if (r.devCode) sessionStorage.setItem('devCode', r.devCode); toast('A new code was sent'); verifyEmail(view); } catch (e) { toast(e.message, 'bad'); }
  };
}

// ---------------------------------------------------------------- citizenship application
export async function apply(view) {
  const u = user();
  if (!u) return go('/login?next=/apply');
  if (u.status === 'email') return go('/verify-email');
  if (u.status === 'approved' || u.status === 'citizen') return go('/passport');
  const { application } = await api.get('/api/account/application');
  if (u.status === 'review') {
    mount(view, narrow(html`${steps('review')}<div class="card pad-lg center" style="padding:36px">
      <span class="dept-icon" style="margin:0 auto 14px;width:56px;height:56px">${icon('eye')}</span>
      <h2>Your application is under review</h2>
      ${application?.guardian_email && !application.guardian_consent_at ? html`<div class="callout warn" style="text-align:left;margin:14px 0">${icon('alert')}<div><b>Waiting for your parent or guardian.</b> We emailed ${application.guardian_name} at ${application.guardian_email}. A registrar can only approve you after they open the link and agree.<div style="margin-top:8px"><button type="button" class="btn sm" data-resend-guardian>Send the email again</button></div></div></div>` : ''}
      <p class="muted">Submitted ${fmtDateTime(application?.created_at)}. A registrar at the Department of Citizenship & Identity will compare your document and live selfie, and check that you do not already hold citizenship. You'll see the result here.</p>
      <div class="row" style="justify-content:center"><a class="btn" href="#/forum/c/help">Ask the Help Desk</a><a class="btn" href="#/laws">Read the Constitution meanwhile</a></div></div>`));
    const resend = view.querySelector('[data-resend-guardian]');
    if (resend) {
      resend.onclick = async () => {
        resend.disabled = true;
        try { await api.post('/api/account/guardian/resend', {}); toast('Email sent again', 'ok'); } catch (e) { toast(e.message, 'bad'); resend.disabled = false; }
      };
    }
    return;
  }
  if (u.status === 'banned') return mount(view, narrow(html`<div class="callout bad">${icon('alert')}<div><b>Application refused permanently.</b><p>${application?.review_note || ''}</p></div></div>`));

  const { phrase } = await api.get('/api/account/liveness');
  mount(view, narrow(html`${steps('documents')}
  <div class="page-head"><span class="eyebrow">Step 3 of 5</span><h1>Prove you are a real, unique person</h1>
    <p>Your document and selfie are seen only by citizenship registrars and are never published. We keep a keyed fingerprint of your document number, so it can never back a second account.</p></div>
  ${u.status === 'rejected' && application ? html`<div class="callout bad" style="margin-bottom:18px">${icon('alert')}<div><b>Your previous application was not approved.</b><p>${application.review_note || 'No reason given.'}</p></div></div>` : ''}
  <form class="stack" data-form>
    <div class="card"><div class="card-head"><h3>1 · Your legal identity</h3></div><div class="pad form">
      <label class="field"><span>Full legal name</span><input class="input" name="legalName" required minlength="3" maxlength="100" placeholder="As shown on your document"></label>
      <div class="grid g2">
        <label class="field"><span>Date of birth</span><input class="input" type="date" name="dob" required max="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="field"><span>Document issued by (country)</span><input class="input" name="country" required maxlength="56" placeholder="e.g. United States"></label>
        <label class="field"><span>Document type</span><select class="input" name="docType"><option value="passport">Passport</option><option value="national_id">National ID card</option><option value="drivers_license">Driver’s licence</option><option value="student_id">School or student ID</option><option value="birth_certificate">Birth certificate</option></select></label>
        <label class="field"><span>Document number</span><input class="input" name="docNumber" required minlength="4" maxlength="30" autocomplete="off"><small>Stored only as a one-way fingerprint plus its last 4 characters.</small></label>
      </div>
      <div class="stack tight hide" data-guardian>
        <div class="callout warn small">${icon('alert')}<div><b>You're under 13</b>, so a parent or guardian has to agree before you can become a citizen. We'll email them a link explaining what joining means.</div></div>
        <div class="grid g2">
          <label class="field"><span>Parent or guardian's name</span><input class="input" name="guardianName" maxlength="100"></label>
          <label class="field"><span>Parent or guardian's email</span><input class="input" type="email" name="guardianEmail" maxlength="200"><small>Their own email, not yours.</small></label>
        </div></div></div></div>

    <div class="card"><div class="card-head"><h3>2 · Photo of your document</h3></div><div class="pad stack tight">
      <label class="dropzone" data-docdrop>${icon('file')}<strong>Upload a clear photo of your document</strong><span class="small">The page with your photo, if it has one</span><span class="small">JPEG, PNG or WebP · max 8 MB</span><input type="file" name="document" accept="image/jpeg,image/png,image/webp" hidden></label>
      <img class="preview-img hide" data-docprev alt="Document preview"></div></div>

    <div class="card"><div class="card-head"><h3>3 · Live selfie</h3><span class="badge warn">Liveness check</span></div><div class="pad stack">
      <div class="liveness">${icon('alert')} ${phrase}</div>
      <p class="small muted" style="margin:0">Take the selfie with your camera while doing exactly what the prompt says. The prompt is random and expires in 30 minutes, which proves the photo was taken now, by you.</p>
      <div class="grid g2">
        <div class="camera"><video data-video playsinline muted></video><img class="hide" data-shot alt="Your selfie"><div class="frame"></div></div>
        <div class="stack tight">
          <button type="button" class="btn primary" data-start>${icon('camera')} Start camera</button>
          <button type="button" class="btn" data-snap disabled>${icon('camera')} Take selfie</button>
          <button type="button" class="btn ghost hide" data-retake>Retake</button>
          <hr style="margin:6px 0"><label class="small muted" style="cursor:pointer"><u>No camera? Upload a selfie instead</u> (flagged for closer review)<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-selfiefile></label>
          <div class="small" data-selfiestatus></div>
        </div>
      </div></div></div>

    <div class="card pad stack tight">
      <label class="check"><input type="checkbox" required> I confirm this is my own identity document, that I have no other account in ${nation().short}, and I understand that creating a duplicate account leads to permanent loss of citizenship.</label>
      <button class="btn primary lg" type="submit">${icon('send')} Submit application</button>
    </div>
  </form>`));

  const form = view.querySelector('[data-form]');
  const guardianBox = view.querySelector('[data-guardian]');
  form.dob.oninput = () => {
    const age = (Date.now() - Date.parse(form.dob.value)) / (365.25 * 864e5);
    const child = age > 0 && age < 13;
    guardianBox.classList.toggle('hide', !child);
    form.guardianName.required = form.guardianEmail.required = child;
  };
  const docInput = form.querySelector('input[name=document]');
  const docDrop = view.querySelector('[data-docdrop]');
  docInput.onchange = () => {
    const f = docInput.files[0]; if (!f) return;
    docDrop.classList.add('has'); docDrop.querySelector('strong').textContent = f.name;
    const img = view.querySelector('[data-docprev]'); img.src = URL.createObjectURL(f); img.classList.remove('hide');
  };

  let selfie = null; let live = false; let stream = null; let dhash = null;
  const video = view.querySelector('[data-video]'); const shot = view.querySelector('[data-shot]');
  const status = view.querySelector('[data-selfiestatus]');
  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  window.addEventListener('hashchange', stop, { once: true });
  view.querySelector('[data-start]').onclick = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 960, height: 720 }, audio: false });
      video.srcObject = stream; await video.play();
      shot.classList.add('hide'); video.classList.remove('hide');
      view.querySelector('[data-snap]').disabled = false;
    } catch (e) { toast(`Camera unavailable: ${e.message}`, 'bad'); }
  };
  view.querySelector('[data-snap]').onclick = async () => {
    const c = Object.assign(document.createElement('canvas'), { width: video.videoWidth, height: video.videoHeight });
    const ctx = c.getContext('2d'); ctx.translate(c.width, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0);
    selfie = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9)); live = true;
    dhash = differenceHash(c);
    shot.src = URL.createObjectURL(selfie); shot.classList.remove('hide'); video.classList.add('hide');
    stop(); view.querySelector('[data-snap]').disabled = true; view.querySelector('[data-retake]').classList.remove('hide');
    status.innerHTML = '<span style="color:var(--ok)">✓ Live selfie captured</span>';
  };
  view.querySelector('[data-retake]').onclick = () => view.querySelector('[data-start]').click();
  view.querySelector('[data-selfiefile]').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    selfie = f; live = false;
    const img = await createImageBitmap(f); const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    c.getContext('2d').drawImage(img, 0, 0); dhash = differenceHash(c);
    shot.src = URL.createObjectURL(f); shot.classList.remove('hide'); video.classList.add('hide');
    status.innerHTML = '<span style="color:var(--warn)">Selfie uploaded from file (will be flagged)</span>';
  };

  handleForm(form, async () => {
    if (!docInput.files[0]) throw new Error('Add a photo of your identity document');
    if (!selfie) throw new Error('Take your live selfie');
    const fd = new FormData(form);
    fd.set('selfie', selfie, 'selfie.jpg');
    fd.set('liveCapture', live ? '1' : '0');
    if (dhash) fd.set('dhash', dhash);
    const res = await api.post('/api/account/application', fd);
    await refreshMe();
    if (res.guardianEmailed === false) toast('Application submitted, but the email to your parent or guardian failed. Send it again from the next page.', 'bad');
    else toast('Application submitted', 'ok');
    apply(view);
  });
}

/** 64-bit perceptual difference hash — a weak duplicate-face signal shown to reviewers. */
function differenceHash(source) {
  const c = Object.assign(document.createElement('canvas'), { width: 9, height: 8 });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, source.width * 0.2, source.height * 0.1, source.width * 0.6, source.height * 0.8, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data;
  const g = (x, y) => { const i = (y * 9 + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g(x, y) > g(x + 1, y) ? '1' : '0';
  return bits.match(/.{4}/g).map((b) => parseInt(b, 2).toString(16)).join('');
}

// ---------------------------------------------------------------- passport + .access key
export async function passport(view) {
  const u = user();
  if (!u) return go('/login?next=/passport');
  if (!['approved', 'citizen'].includes(u.status)) return go('/apply');
  if (u.status === 'approved' || u.keyReissue === 'allowed') return issueFlow(view, u.status === 'citizen');
  const n = nation();
  const svgUrl = `/api/account/passport.svg?v=${u.passportVersion}`;
  const elevatedUntil = state.me.elevation?.passportUntil || 0;
  mount(view, html`
  <div class="page-head row between"><div><span class="eyebrow">Department of Citizenship & Identity</span><h1>My passport</h1>
    <p>Your passport carries an embedded government signature. Uploading it proves your identity for standard secure actions. Your .access key protects ultra-secure ones.</p></div></div>
  <div class="split">
    <div class="stack">
      <div class="passport-frame"><img src="${svgUrl}" alt="Passport data page"></div>
      <div class="row"><button class="btn primary" data-svg>${icon('download')} Download passport (SVG)</button><button class="btn" data-png>${icon('download')} Download as PNG</button>
        <a class="btn ghost" href="#/verify/${u.passportNo}">${icon('shield')} Public verification page</a></div>
    </div>
    <aside class="stack">
      <div class="card pad">${describe([['Passport no.', html`<b class="mono">${u.passportNo}</b>`], ['Holder', u.legalName || u.displayName], ['Citizen since', fmtDate(u.citizenSince)], ['Passport version', `v${u.passportVersion}`], ['Key-Id', html`<span class="mono">${u.keyId}</span>`]])}</div>
      <div class="card pad stack tight"><h4 style="margin:0">${icon('id')} Passport check</h4>
        ${elevatedUntil > Date.now() ? html`<div class="callout ok small">${icon('check')}<div>Verified for this session — ${until(elevatedUntil)} left.</div></div>` : html`<p class="small muted" style="margin:0">Not verified this session. You'll be asked automatically when needed.</p>`}
        <button class="btn sm" data-check>Verify now</button></div>
      <div class="card pad stack tight"><h4 style="margin:0">${icon('key')} .access key</h4>
        <p class="small muted" style="margin:0">Required to send ${n.currency.plural}, buy, vote and change your password. The government never has a copy.</p>
        <button class="btn sm" data-test>Test my .access key</button>
        ${u.keyReissue === 'requested' ? html`<div class="callout warn small">${icon('clock')}<div>Key reissue requested — awaiting the Department of Citizenship.</div></div>`
          : html`<button class="btn sm danger" data-lost>I lost my .access file</button>`}</div>
    </aside>
  </div>`);
  const fetchSvg = async () => (await fetch(svgUrl, { credentials: 'same-origin' })).text();
  view.querySelector('[data-svg]').onclick = async () => downloadText(`passport-${u.passportNo}.svg`, await fetchSvg(), 'image/svg+xml');
  view.querySelector('[data-png]').onclick = async (e) => {
    e.target.disabled = true;
    try { downloadText(`passport-${u.passportNo}.png`, await passportSvgToPng(await fetchSvg()), 'image/png'); } catch (err) { toast(err.message, 'bad'); }
    e.target.disabled = false;
  };
  view.querySelector('[data-check]').onclick = async () => { if (await passportCheck()) passport(view); };
  view.querySelector('[data-test]').onclick = async () => {
    const params = { nonce: crypto.randomUUID() };
    const r = await accessOp({ op: 'account.keytest', params, title: 'Test your .access key', summary: html`Nothing will change. This confirms your file decrypts, signs a rotating-key challenge, and matches the key on your passport.`, submit: (auth) => api.post('/api/account/key/test', { params, auth }) });
    if (r) toast('Your .access key works ✓', 'ok');
  };
  view.querySelector('[data-lost]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Report a lost .access file?', 'A registrar must approve the reissue. Once approved you will generate a new key here, and your current passport images and .access file will stop working.', { okLabel: 'Request reissue', danger: true }))) return;
    const done = await modal({ title: 'Confirm with your password', iconName: 'lock' }, (body, close) => {
      mount(body, html`<form class="form"><label class="field"><span>Account password</span><input class="input" type="password" name="password" required autocomplete="current-password"></label>
        <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Request reissue</button></div></form>`);
      handleForm(body.querySelector('form'), async ({ password }) => { await api.post('/api/account/key/report-lost', { password }); close(true); });
    });
    if (done) { await refreshMe(); passport(view); toast('Reissue requested'); }
  });
}

function issueFlow(view, reissue) {
  const u = user();
  const n = nation();
  mount(view, narrow(html`${reissue ? '' : steps('approved')}
  <div class="card pad-lg stack" style="padding:28px" data-step1>
    <span class="dept-icon" style="width:56px;height:56px">${icon('key')}</span>
    <h1 style="margin:0">${reissue ? 'Generate your replacement .access key' : `Congratulations — you are approved, ${u.displayName}!`}</h1>
    <p class="muted" style="margin:0">Your browser will now create your personal signing key. The private half is encrypted with your password into a <b>.access file</b> that you download and keep. Only the public half is sent to the government, which signs it into your passport.</p>
    <div class="callout warn">${icon('alert')}<div><b>The government cannot recover your .access file.</b> Save it somewhere safe (a password manager, an encrypted USB drive). You need it to send ${n.currency.plural}, buy, vote and change your password.</div></div>
    <form class="form" data-form>
      <label class="field"><span>Confirm your account password</span><input class="input" type="password" name="password" required autocomplete="current-password"><small>Used to encrypt the .access file — it never leaves this device in the file.</small></label>
      <button class="btn gold lg" type="submit">${icon('key')} Generate key &amp; issue my passport</button>
    </form>
  </div>`));
  handleForm(view.querySelector('[data-form]'), async ({ password }) => {
    const kp = await generateKeyPair();
    const w = aurumWallet(kp.pkcs8);
    const chainProof = await linkProof(w, n.name, u.username, kp.keyId);
    const r = await api.post('/api/account/passport/issue', { password, publicKey: kp.publicKey, chainAddress: w.address, chainProof });
    const fileText = await sealAccessFile({ ...kp, account: u.username, passportNo: r.passportNo, nation: n.name, password });
    await refreshMe();
    showKeyDownload(view, fileText, r);
  });
}

function showKeyDownload(view, fileText, r) {
  const u = user();
  const n = nation();
  const fname = `${u.username}-${r.passportNo}.access`;
  let downloaded = false;
  mount(view, narrow(html`${steps('citizen')}
  <div class="card pad-lg stack" style="padding:28px">
    <div class="row"><span class="dept-icon" style="background:var(--ok-soft);color:var(--ok)">${icon('check')}</span><div><h2 style="margin:0">Passport ${r.passportNo} issued</h2>
      ${r.granted ? html`<div class="muted">${num(r.granted)} ${n.currency.plural} worth <b>${num(r.grantValue)} ${n.currency.symbol}</b> have been minted to your wallet.</div>` : ''}</div></div>
    <h3 style="margin:8px 0 0">Download your .access key now</h3>
    <p class="muted" style="margin:0">This is the only time it can be downloaded. It contains your private key, encrypted (AES-256-GCM) with your password.</p>
    <div class="keyfile">${fileText}</div>
    <button class="btn primary lg" data-dl>${icon('download')} Download ${fname}</button>
    <label class="check"><input type="checkbox" data-saved disabled> I have saved my .access file somewhere safe and understand it cannot be recovered.</label>
    <button class="btn" data-done disabled>Continue to my passport ${icon('arrow')}</button>
  </div>`));
  const leaveGuard = (e) => { if (!downloaded) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', leaveGuard);
  view.querySelector('[data-dl]').onclick = () => {
    downloadText(fname, fileText); downloaded = true;
    view.querySelector('[data-saved]').disabled = false;
  };
  view.querySelector('[data-saved]').onchange = (e) => { view.querySelector('[data-done]').disabled = !e.target.checked; };
  view.querySelector('[data-done]').onclick = () => { window.removeEventListener('beforeunload', leaveGuard); go('/passport'); };
}

// ---------------------------------------------------------------- settings
export async function settings(view) {
  const u = user();
  if (!u) return go('/login?next=/settings');
  const ep = state.me.epoch;
  mount(view, html`<div class="page-head"><h1>Settings &amp; security</h1></div>
  <div class="split"><div class="stack">
    ${u.status === 'citizen' ? html`<form class="card" data-profile><div class="card-head"><h3>Public profile</h3><span class="badge">Passport check</span></div><div class="pad form">
      <label class="field"><span>Display name</span><input class="input" name="displayName" value="${u.displayName}" required minlength="2" maxlength="40"></label>
      <label class="field"><span>Bio</span><textarea class="input" name="bio" maxlength="500">${u.bio}</textarea></label>
      <div><button class="btn primary" type="submit">Save profile</button></div></div></form>

    <form class="card" data-password><div class="card-head"><h3>Change password</h3><span class="badge gold">.access key</span></div><div class="pad form">
      <p class="small muted" style="margin:0">Your .access file is encrypted with your password, so changing it re-encrypts the file here in your browser and gives you a new copy to download. Your key itself doesn’t change.</p>
      <div class="field"><span>Your current .access file</span><input class="input" type="file" name="file" accept=".access" required></div>
      <div class="grid g2"><label class="field"><span>Current password</span><input class="input" type="password" name="current" required autocomplete="current-password"></label>
      <label class="field"><span>New password</span><input class="input" type="password" name="next" required minlength="10" autocomplete="new-password"></label></div>
      <div class="secure-trace hide" data-trace></div>
      <div><button class="btn primary" type="submit">${icon('lock')} Change password &amp; re-encrypt key</button></div></div></form>` : ''}
  </div>
  <aside class="stack">
    <div class="card pad">${describe([['Account', `@${u.username}`], ['Email', html`${u.email} ${u.emailVerified ? html`<span class="badge ok">verified</span>` : ''}`], ['Status', u.status], ['Role', u.role]])}</div>
    <div class="card pad stack tight"><h4 style="margin:0">${icon('shield')} Security levels</h4>
      <div class="small"><b>Standard</b> — account name + password.</div>
      <div class="small"><b>Elevated</b> — plus a passport image check (15 min).</div>
      <div class="small"><b>Ultra-secure</b> — .access key signs a rotating-key challenge, then account name + password.</div>
      <div class="small muted">Current rotating key epoch <span class="mono">${ep.epoch}</span>, fingerprint <span class="mono">${ep.fingerprint}</span>.</div>
      <a class="small" href="#/security">Read the full security model</a></div>
  </aside></div>`);

  const profile = view.querySelector('[data-profile]');
  if (profile) handleForm(profile, async (d) => { await api.patch('/api/account/profile', d); await refreshMe(); toast('Profile saved', 'ok'); });
  const pw = view.querySelector('[data-password]');
  if (pw) {
    const trace = pw.querySelector('[data-trace]');
    const log = (m, c = '') => { trace.classList.remove('hide'); const d = document.createElement('div'); d.className = c; d.textContent = m; trace.append(d); };
    handleForm(pw, async () => {
      trace.textContent = '';
      try {
        const text = await pw.file.files[0].text();
        log('Decrypting .access file with current password…');
        const { signingKey, headers, pkcs8 } = await unlockAccessFile(text, pw.current.value, u.username);
        if (headers['Key-Id'] !== u.keyId) throw new Error('This .access file is not your current key');
        log('Decrypted ✓', 'ok');
        const ch = await api.post('/api/secure/challenge', { op: 'account.password', params: {} });
        log(`Signing challenge (epoch ${ch.epoch})…`);
        const signature = await signChallenge(signingKey, ch.challenge);
        await api.post('/api/account/password', { params: {}, newPassword: pw.next.value, auth: { challenge: ch.challenge, signature, username: u.username, password: pw.current.value } });
        log('Password changed ✓ — re-encrypting your key with the new password…', 'ok');
        const fileText = await sealAccessFile({ pkcs8, publicKey: headers['Public-Key'], keyId: headers['Key-Id'], account: u.username, passportNo: headers.Passport, nation: nation().name, password: pw.next.value });
        downloadText(`${u.username}-${headers.Passport}.access`, fileText);
        log('New .access file downloaded. Replace your old copy with it.', 'ok');
        toast('Password changed. Your new .access file was downloaded.', 'ok');
        pw.reset();
      } catch (e) { log(`✗ ${e.message}`, 'bad'); throw e; }
    });
  }
}
