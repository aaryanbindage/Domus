import express from 'express';
import path from 'node:path';
import { ROOT, PORT, DEV, NATION, PUBLIC_URL } from './config.js';
import './db.js';
import { seed, syncLaws } from './seed.js';
import { loadSession, csrf } from './auth.js';
import account, { secure } from './routes/account.js';
import gov from './routes/gov.js';
import wallet from './routes/wallet.js';
import market from './routes/market.js';
import forum from './routes/forum.js';
import admin from './routes/admin.js';
import { SERVER_PUBLIC_PEM, SERVER_KEY_FINGERPRINT } from './security.js';

seed();
syncLaws();

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "script-src 'self'", "connect-src 'self'", "media-src 'self' blob:",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
  ].join('; '));
  next();
});

app.use(express.json({ limit: '200kb' }));
app.use(loadSession);
app.use('/api', csrf);
app.use('/api/account', account);
app.use('/api/secure', secure);
app.use('/api/gov', gov);
app.use('/api/wallet', wallet);
app.use('/api/market', market);
app.use('/api/forum', forum);
app.use('/api/admin', admin);
app.get('/api/server-key', (_req, res) => res.json({ algorithm: 'Ed25519', fingerprint: SERVER_KEY_FINGERPRINT, publicKey: SERVER_PUBLIC_PEM }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html', maxAge: DEV ? 0 : '1h' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  const body = { error: status >= 500 ? 'Internal server error' : err.message };
  if (err.need) body.need = err.need;
  if (err.op) body.op = err.op;
  res.status(status).json(body);
});

app.listen(PORT, () => console.log(`${NATION.name} is online at ${PUBLIC_URL}${DEV ? '  (development mode: email codes print here)' : ''}`));
