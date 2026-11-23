// Authorises Domus to send email from a Gmail account using OAuth, for accounts where app
// passwords don't work. Run it on a computer with a browser:
//
//   npm run gmail-oauth -- <client-id> <client-secret> [output-file]
//
// The client id and secret come from a Google Cloud "Desktop app" OAuth client (see DEPLOY.md).
// It opens Google's consent page, receives the answer on a local port, and prints the
// GMAIL_* lines to put in /etc/domus.env (or writes them to output-file).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const [clientId, clientSecret, outFile] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Usage: npm run gmail-oauth -- <client-id> <client-secret> [output-file]');
  process.exit(1);
}

const b64url = (buf) => buf.toString('base64url');
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const state = b64url(crypto.randomBytes(16));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/') { res.writeHead(404).end(); return; }
  const done = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<p style="font:16px system-ui;margin:3em">${msg}</p>`); };
  if (url.searchParams.get('state') !== state) { done('This link has expired — run the command again.'); return; }
  if (url.searchParams.get('error')) { done(`Google said: ${url.searchParams.get('error')}`); finish(new Error(url.searchParams.get('error'))); return; }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }),
    });
    const tok = await r.json();
    if (!r.ok) throw new Error(tok.error_description || tok.error || `HTTP ${r.status}`);
    if (!tok.refresh_token) throw new Error('Google returned no refresh token — remove Domus at myaccount.google.com/permissions and run this again');
    const email = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString()).email;
    done(`Done — Domus may now send email as <b>${email}</b>. You can close this tab.`);
    finish(null, [`GMAIL_USER=${email}`, `GMAIL_CLIENT_ID=${clientId}`, `GMAIL_CLIENT_SECRET=${clientSecret}`, `GMAIL_REFRESH_TOKEN=${tok.refresh_token}`].join('\n'));
  } catch (e) {
    done(`Failed: ${e.message}`);
    finish(e);
  }
});

let redirect;
function finish(err, lines) {
  server.close();
  if (err) { console.error(`Failed: ${err.message}`); process.exit(1); }
  if (outFile) {
    fs.writeFileSync(outFile, lines + '\n', { mode: 0o600 });
    console.log(`Saved the GMAIL_* settings to ${outFile}`);
  } else {
    console.log(`\nAdd these lines to /etc/domus.env on the server, then restart Domus:\n\n${lines}\n`);
  }
}

server.listen(0, '127.0.0.1', () => {
  redirect = `http://127.0.0.1:${server.address().port}`;
  const auth = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code', state,
    scope: 'openid email https://mail.google.com/', access_type: 'offline', prompt: 'consent',
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  console.log(`Open this link and sign in with the Gmail account Domus should send from:\n\n${auth}\n`);
  const opener = process.platform === 'win32' ? ['explorer.exe', [auth]] : process.platform === 'darwin' ? ['open', [auth]] : ['xdg-open', [auth]];
  try { spawn(...opener, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* the link is printed above */ }
});
