// Tells Bing, Yandex, Naver, Seznam and other IndexNow search engines that the site changed.
// Run after a deploy: PUBLIC_URL=https://example.org node scripts/indexnow.js
import fs from 'node:fs';
import path from 'node:path';

const site = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
if (!/^https:\/\//.test(site)) throw new Error('Set PUBLIC_URL to the public https address');
const keyFile = fs.readdirSync(path.join(import.meta.dirname, '..', 'public')).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error('No IndexNow key file (<32 hex>.txt) in public/');
const key = keyFile.slice(0, -4);

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(site).host, key, keyLocation: `${site}/${keyFile}`, urlList: [`${site}/`] }),
});
console.log(`IndexNow HTTP ${res.status}`);
