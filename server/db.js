import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, UPLOAD_DIR, PRIVATE_DIR } from './config.js';

for (const d of [DATA_DIR, UPLOAD_DIR, PRIVATE_DIR]) fs.mkdirSync(d, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'nation.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  pw_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',          -- member | official | admin
  status TEXT NOT NULL DEFAULT 'email',         -- email | documents | review | approved | citizen | rejected | banned | suspended
  department_id INTEGER,
  official_title TEXT,
  bio TEXT NOT NULL DEFAULT '',
  public_key TEXT,                              -- ECDSA P-256 SPKI (base64); private half lives only in the .access file
  key_id TEXT,
  key_version INTEGER NOT NULL DEFAULT 0,
  key_reissue TEXT NOT NULL DEFAULT 'none',     -- none | requested | allowed
  passport_no TEXT UNIQUE,
  passport_version INTEGER NOT NULL DEFAULT 0,
  passport_issued_at INTEGER,
  legal_name TEXT,
  dob TEXT,
  photo_path TEXT,
  citizen_since INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_codes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS liveness (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL, expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  legal_name TEXT NOT NULL, dob TEXT NOT NULL, country TEXT NOT NULL, doc_type TEXT NOT NULL,
  doc_hmac TEXT NOT NULL, doc_last4 TEXT NOT NULL, person_hmac TEXT NOT NULL,
  doc_image TEXT NOT NULL, selfie_image TEXT NOT NULL, live_capture INTEGER NOT NULL DEFAULT 1,
  liveness_phrase TEXT NOT NULL, selfie_dhash TEXT, ip_hmac TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected | banned
  reviewer_id INTEGER, review_note TEXT,
  created_at INTEGER NOT NULL, reviewed_at INTEGER
);
-- One identity document = one citizen, forever (rejected applications may retry; bans hold the document).
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_doc ON applications(doc_hmac) WHERE status IN ('pending','approved','banned');

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  passport_until INTEGER NOT NULL DEFAULT 0, ip TEXT, ua TEXT
);

CREATE TABLE IF NOT EXISTS used_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS tokens (
  serial INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  rarity TEXT NOT NULL, rarity_rank INTEGER NOT NULL,
  minted_at INTEGER NOT NULL,
  locked_order INTEGER
);
CREATE INDEX IF NOT EXISTS ix_tokens_owner ON tokens(owner_id, locked_order, rarity_rank);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL, type TEXT NOT NULL,
  from_id INTEGER, to_id INTEGER, amount INTEGER NOT NULL,
  serials TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', ref TEXT,
  op_params TEXT, challenge TEXT, sender_sig TEXT,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, server_sig TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ledger_from ON ledger(from_id);
CREATE INDEX IF NOT EXISTS ix_ledger_to ON ledger(to_id);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, short TEXT NOT NULL,
  branch TEXT NOT NULL, head_title TEXT NOT NULL, mission TEXT NOT NULL, description TEXT NOT NULL,
  services TEXT NOT NULL DEFAULT '[]', contact TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT 'building',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL,
  category TEXT NOT NULL, department_id INTEGER, author_id INTEGER,
  published_at INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS laws (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, kind TEXT NOT NULL,
  summary TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'in_force',
  enacted_at INTEGER NOT NULL, bill_id INTEGER, department_id INTEGER
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL,
  sponsor_id INTEGER NOT NULL, department_id INTEGER,
  status TEXT NOT NULL DEFAULT 'gathering',     -- gathering | voting | passed | failed | enacted | vetoed | withdrawn
  created_at INTEGER NOT NULL, voting_starts INTEGER, voting_ends INTEGER,
  yes INTEGER NOT NULL DEFAULT 0, no INTEGER NOT NULL DEFAULT 0, abstain INTEGER NOT NULL DEFAULT 0,
  law_id INTEGER
);
CREATE TABLE IF NOT EXISTS bill_signatures (
  bill_id INTEGER NOT NULL, user_id INTEGER NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (bill_id, user_id)
);
CREATE TABLE IF NOT EXISTS bill_votes (
  bill_id INTEGER NOT NULL, user_id INTEGER NOT NULL, choice TEXT NOT NULL, ts INTEGER NOT NULL,
  challenge TEXT NOT NULL, sig TEXT NOT NULL, PRIMARY KEY (bill_id, user_id)
);

CREATE TABLE IF NOT EXISTS gazette (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', ref TEXT
);

CREATE TABLE IF NOT EXISTS records_requests (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, department_id INTEGER, subject TEXT NOT NULL,
  details TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', response TEXT, responder_id INTEGER,
  created_at INTEGER NOT NULL, responded_at INTEGER
);

CREATE TABLE IF NOT EXISTS forum_categories (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0, official_only INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS forum_threads (
  id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL, user_id INTEGER NOT NULL, title TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_post_at INTEGER NOT NULL, post_count INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS forum_posts (
  id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL,
  created_at INTEGER NOT NULL, edited_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_posts_thread ON forum_posts(thread_id, id);
CREATE TABLE IF NOT EXISTS forum_likes (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, target_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  reason TEXT NOT NULL, created_at INTEGER NOT NULL, resolved_by INTEGER, resolved_at INTEGER, resolution TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY, seller_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
  category TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL, item_condition TEXT NOT NULL,
  delivery TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active',
  views INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL, total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'escrow',        -- escrow | shipped | completed | refunded | disputed
  ship_note TEXT, rating INTEGER, review TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_messages (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, user_id INTEGER, action TEXT NOT NULL, detail TEXT
);
`);

// Migrations for databases created by earlier versions.
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasColumn('users', 'chain_address')) db.exec('ALTER TABLE users ADD COLUMN chain_address TEXT');
if (!hasColumn('ledger', 'chain_tx')) db.exec('ALTER TABLE ledger ADD COLUMN chain_tx TEXT');
for (const col of ['guardian_name TEXT', 'guardian_email TEXT', 'guardian_token TEXT', 'guardian_consent_at INTEGER', 'guardian_declined_at INTEGER']) {
  if (!hasColumn('applications', col.split(' ')[0])) db.exec(`ALTER TABLE applications ADD COLUMN ${col}`);
}
if (!hasColumn('laws', 'area')) db.exec("ALTER TABLE laws ADD COLUMN area TEXT NOT NULL DEFAULT 'Citizen Legislation'");

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export const q = {
  get: (sql, ...p) => stmt(sql).get(...norm(p)),
  all: (sql, ...p) => stmt(sql).all(...norm(p)),
  run: (sql, ...p) => stmt(sql).run(...norm(p)),
};

let depth = 0;
/** Run fn atomically. Nested calls become savepoints. */
export function tx(fn) {
  const sp = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

export const now = () => Date.now();
export function audit(userId, action, detail) {
  q.run('INSERT INTO audit (ts, user_id, action, detail) VALUES (?,?,?,?)', now(), userId, action,
    detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail));
}
export function gazette(kind, title, body = '', ref = null) {
  q.run('INSERT INTO gazette (ts, kind, title, body, ref) VALUES (?,?,?,?,?)', now(), kind, title, body, ref);
}
