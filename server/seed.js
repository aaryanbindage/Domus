import { q, tx, now, gazette } from './db.js';
import { NATION, SECURITY } from './config.js';
import { buildLaws } from './laws.js';

const N = NATION;
const C = N.currency;

const DEPARTMENTS = [
  ['president', 'Office of the Head of State', 'Head of State', 'executive', 'Head of State', 'crown',
    `Lead the ${N.short} government, give assent to Acts passed by the people, and appoint officials.`,
    `The Office of the Head of State is the chief executive of the ${N.name}. It grants or withholds assent to bills that pass the national vote, appoints and dismisses officials, and represents ${N.short} to other communities online.`,
    [['Laws awaiting assent', '#/laws/bills?status=passed'], ['Official appointments', '#/records/gazette?kind=appointment']]],
  ['assembly', 'National Assembly', 'Assembly', 'legislative', 'Speaker of the Assembly', 'columns',
    'Make law through direct citizen participation.',
    `${N.short} is a direct democracy. Every citizen sits in the National Assembly: any citizen may table a bill, and once it collects ${SECURITY.billSignatureThreshold} sponsor signatures it goes to a ${SECURITY.billVotingDays}-day national vote. Votes are signed with each citizen's .access key.`,
    [['Browse bills', '#/laws/bills'], ['Propose a bill', '#/laws/bills/new'], ['Legislative record', '#/records/gazette?kind=legislation']]],
  ['judiciary', 'Supreme Tribunal', 'Tribunal', 'judicial', 'Chief Justice', 'scale',
    'Interpret the Constitution and resolve disputes between citizens.',
    'The Supreme Tribunal hears constitutional questions, appeals of moderation and citizenship decisions, and marketplace disputes escalated from the Department of Commerce.',
    [['Read the Constitution', '#/laws?kind=constitution'], ['Ask on the Help Desk', '#/forum/c/help']]],
  ['citizenship', 'Department of Citizenship & Identity', 'Citizenship', 'agency', 'Registrar General', 'id',
    'Verify that every citizen is one real person, and issue passports and .access keys.',
    `The Department reviews citizenship applications (identity document + live selfie), guards against duplicate accounts, issues digital passports and .access key files, and handles lost-key reissues. It never sees or stores your private key.`,
    [['Apply for citizenship', '#/join'], ['My passport', '#/passport'], ['Verify a passport', '#/verify'], ['Report a lost .access key', '#/settings']]],
  ['treasury', 'Treasury & Mint', 'Treasury', 'agency', 'Master of the Mint', 'coin',
    `Issue and safeguard the ${C.name} (${C.symbol}), and publish the public ledger.`,
    `The Treasury mints ${N.citizenshipGrant} ${C.plural} to every new citizen. Each ${C.name} is a numbered collectible with a rarity. The Treasury maintains the hash-chained public ledger, which anyone can audit.`,
    [['My wallet', '#/wallet'], ['Public ledger', '#/records/ledger'], ['Treasury statistics', '#/records/treasury']]],
  ['commerce', 'Department of Commerce', 'Commerce', 'agency', 'Secretary of Commerce', 'store',
    'Keep the national marketplace fair, safe and free.',
    'Commerce oversees the Marketplace, runs the escrow system that holds payment until buyers confirm delivery, and rules on disputes between buyers and sellers.',
    [['Open the Marketplace', '#/market'], ['Sell something', '#/market/sell'], ['My orders', '#/market/orders']]],
  ['justice', 'Department of Justice', 'Justice', 'agency', 'Attorney General', 'gavel',
    'Enforce the law and the Public Forum Conduct Act.',
    'Justice handles reports of fraud, harassment and rule-breaking, moderates public spaces together with officials, and refers serious matters to the Supreme Tribunal.',
    [['Forum rules', '#/laws'], ['Public forum', '#/forum']]],
  ['digital', 'Department of Digital Security', 'Digital Security', 'agency', 'Chief Security Officer', 'shield',
    'Protect citizens’ identities and keys.',
    'Digital Security operates the rotating server key, the passport-signing key, and the challenge–response system that lets citizens authorise sensitive actions with their .access file.',
    [['How our security works', '#/security'], ['Account security', '#/settings']]],
  ['records', 'National Archives & Public Records', 'Archives', 'agency', 'Archivist', 'archive',
    'Open government by default.',
    'The Archives publishes the Citizen Registry, the Official Gazette, the public ledger, legislative history and responses to public records requests.',
    [['Public records', '#/records'], ['Request a record', '#/records/requests']]],
  ['communications', 'Department of Communications', 'Communications', 'agency', 'Press Secretary', 'megaphone',
    'Keep citizens informed.',
    'Communications publishes official news and announcements from every department.',
    [['Latest news', '#/news']]],
  ['education', 'Department of Education & Culture', 'Culture', 'agency', 'Minister of Culture', 'book',
    `Grow the culture and knowledge of ${N.short}.`,
    'Culture runs the civic onboarding guide, community events, and recognition of outstanding contributions to the nation.',
    [['New citizen guide', '#/security'], ['Community forum', '#/forum/c/general']]],
  ['foreign', 'Department of Foreign Affairs', 'Foreign Affairs', 'agency', 'Foreign Minister', 'globe',
    'Represent the nation to other online communities.',
    `Foreign Affairs maintains relations with other online nations, communities and projects, and publishes ${N.short}’s official positions.`,
    [['Diplomatic notices', '#/records/gazette?kind=notice']]],
];

const NEWS = [
  ['announcement', 'communications', `${N.name} opens its borders to its first citizens`, `Applications for citizenship are now open. Every verified citizen receives a passport, a personal .access key and ${N.citizenshipGrant} ${C.plural}.`,
    `Today the ${N.name} formally opens for citizenship.\n\nTo join, create an account, verify your email, and submit an identity document together with a live selfie. Once the Department of Citizenship & Identity approves your application, your browser will generate your personal **.access key** and you will be issued a digital passport.\n\nEvery new citizen receives **${N.citizenshipGrant} ${C.plural}**, the national collectible currency, which can be spent in the Marketplace or sent to other citizens.\n\nWelcome to ${N.short}.`, 1],
  ['security', 'digital', 'How your .access key protects you', 'The private key in your .access file never leaves your device. Here is how the rotating server key and challenge signing work.',
    `For the most sensitive actions — sending ${C.plural}, buying in the Marketplace, voting, and changing your password — ${N.short} asks you to scan your **.access file**.\n\n- Your browser decrypts the file with your password. The decrypted text becomes your signing key.\n- The server issues a challenge bound to its **rotating key** (it changes every ${SECURITY.epochSeconds / 60} minutes) and to the exact details of what you are doing.\n- Your key signs the challenge; then you confirm with your account name and password.\n\nBecause the challenge includes the exact amount, recipient or vote, nobody can reuse your signature for anything else, and it expires when the server key rotates.\n\n**Keep your .access file somewhere safe and backed up.** The government cannot recover it for you.`, 0],
  ['economy', 'treasury', `The ${C.name}: every coin a collectible`, `Each ${C.name} carries a serial number and a permanent rarity that sets its value — from ${C.values.common} ${C.symbol} for a common to ${C.values.legendary} ${C.symbol} for a legendary.`,
    `The ${C.name} (${C.symbol}) is not an ordinary currency. Each one is minted with a unique serial number, and its rarity is decided forever by that serial:\n\n- **Common** (${C.values.common} ${C.symbol}): most ${C.plural}\n- **Uncommon** (${C.values.uncommon} ${C.symbol}): about 1 in 6\n- **Rare** (${C.values.rare} ${C.symbol}): about 1 in 21\n- **Epic** (${C.values.epic} ${C.symbol}): 1 in 100\n- **Legendary** (${C.values.legendary} ${C.symbol}): 1 in 500\n\nYour 1,000-Sigil grant is worth about 1,790 ${C.symbol} on average. When you pay, your wallet spends your lowest-value ${C.plural} first so collectibles stay with you; if it can't make exact change, the Mint breaks a larger ${C.name} into change automatically. The full ledger is public under Public Records.`, 0],
  ['legislation', 'assembly', 'Your first bill: how direct democracy works here', `Any citizen can table a bill. With ${SECURITY.billSignatureThreshold} signatures it goes to a ${SECURITY.billVotingDays}-day national vote.`,
    `The National Assembly is every citizen. To propose a law, open **Laws → Bills → Propose a bill**. After ${SECURITY.billSignatureThreshold} citizens sign it, voting opens for ${SECURITY.billVotingDays} days. Bills that pass go to the Head of State for assent and then enter the statute book.`, 0],
  ['community', 'commerce', 'The Marketplace is open for business', `List art, crafts, digital goods and services for ${C.plural}. Every purchase is protected by escrow.`,
    `The national Marketplace is open. Sellers must pass a passport check before listing. Buyers sign purchases with their .access key, and payment is held in escrow until the buyer confirms receipt. If something goes wrong, open a dispute and the Department of Commerce will rule on it.`, 0],
];

const FORUM = [
  ['announcements', 'Official Announcements', 'Statements from government officials.', 1],
  ['general', 'Town Square', 'General discussion among citizens.', 0],
  ['policy', 'Policy & Legislation', 'Debate bills, propose ideas, discuss the law.', 0],
  ['market', 'Marketplace Talk', 'Trading tips, seller introductions, collectible Sigil showcases.', 0],
  ['help', 'Help Desk', 'Questions about citizenship, passports, keys and wallets.', 0],
  ['offtopic', 'The Commons', 'Anything else — games, art, life.', 0],
];

export function seed() {
  if (q.get('SELECT COUNT(*) c FROM departments').c) return;
  tx(() => {
    const t = now();
    DEPARTMENTS.forEach(([slug, name, short, branch, head, icon, mission, description, services], i) => {
      q.run('INSERT INTO departments (slug, name, short, branch, head_title, mission, description, services, contact, icon, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        slug, name, short, branch, head, mission, description, JSON.stringify(services.map(([label, href]) => ({ label, href }))), `${slug}@${N.short.toLowerCase()}.gov`, icon, i);
    });
    const dept = (slug) => q.get('SELECT id FROM departments WHERE slug = ?', slug).id;
    NEWS.forEach(([category, d, title, summary, body, pinned], i) => q.run('INSERT INTO news (title, summary, body, category, department_id, published_at, pinned) VALUES (?,?,?,?,?,?,?)', title, summary, body, category, dept(d), t - i * 3600e3, pinned));
    FORUM.forEach(([slug, name, description, official], i) => q.run('INSERT INTO forum_categories (slug, name, description, sort, official_only) VALUES (?,?,?,?,?)', slug, name, description, i, official));
    gazette('founding', `The ${N.name} is founded`, `The Constitution and the founding statute book enter into force.`, null);
  });
  console.log('[seed] departments, news and forum created');
}

/**
 * Keep the founding statute book in step with server/laws.js. Laws enacted by citizen
 * bills (bill_id set) are never touched.
 */
export function syncLaws() {
  const laws = buildLaws();
  const t = q.get("SELECT MIN(ts) t FROM gazette WHERE kind = 'founding'")?.t || now();
  let added = 0;
  tx(() => {
    for (const l of laws) {
      const dept = q.get('SELECT id FROM departments WHERE slug = ?', l.dept)?.id ?? null;
      const existing = q.get('SELECT id, bill_id FROM laws WHERE code = ?', l.code);
      if (!existing) {
        q.run('INSERT INTO laws (code, title, kind, area, summary, body, enacted_at, department_id) VALUES (?,?,?,?,?,?,?,?)', l.code, l.title, l.kind, l.area, l.summary, l.body, t, dept);
        added++;
      } else if (existing.bill_id == null) {
        q.run('UPDATE laws SET title = ?, kind = ?, area = ?, summary = ?, body = ?, department_id = ? WHERE id = ?', l.title, l.kind, l.area, l.summary, l.body, dept, existing.id);
      }
    }
  });
  if (added) console.log(`[laws] ${added} founding instruments added to the statute book`);
}
