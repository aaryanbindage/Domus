import { q, tx, now, gazette } from './db.js';
import { NATION, SECURITY } from './config.js';

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

const CONSTITUTION = `# Constitution of the ${N.name}

*We, the citizens of ${N.short}, each a real and single person, establish this Constitution so that a community built online may govern itself with the same seriousness as any nation on Earth.*

## Article I — The Nation
1. The ${N.name} is a sovereign online community of its citizens.
2. Its motto is *${N.motto}*. Its currency is the ${C.name} (${C.symbol}).
3. Sovereignty rests with the citizens, exercised directly through the National Assembly.

## Article II — Citizenship
1. Citizenship is open to any natural person aged 13 or older who proves their identity to the Department of Citizenship & Identity.
2. **One person, one citizenship.** No person may hold more than one account. An identity document may back only one citizen, forever.
3. Every citizen is issued a digital passport and a personal **.access key**. The key is the citizen's alone; the State never holds it.
4. Citizenship may be suspended only under law, and every suspension is published in the Official Gazette.

## Article III — Rights of Citizens
1. Freedom of expression in the Public Forum, subject only to the Public Forum Conduct Act.
2. The right to propose, sponsor and vote on legislation.
3. The right to own, trade and keep ${C.plural}, and to sell goods and services in the Marketplace.
4. The right to access public records, and to have personal identity documents kept private.
5. The right to appeal any government decision to the Supreme Tribunal.

## Article IV — The National Assembly
1. Every citizen is a member of the National Assembly.
2. A bill tabled by a citizen opens for a national vote once it has ${SECURITY.billSignatureThreshold} sponsor signatures.
3. A national vote lasts ${SECURITY.billVotingDays} days. A bill passes if Yes votes exceed No votes and turnout reaches one tenth of citizens.
4. Each vote is cryptographically signed with the voter's .access key and recorded permanently.

## Article V — The Head of State
1. The Head of State gives or withholds assent to bills that pass a national vote. A withheld assent must be published with reasons.
2. The Head of State appoints officials to departments, and may dismiss them.

## Article VI — The Supreme Tribunal
1. The Tribunal interprets this Constitution and decides disputes.
2. Its rulings are published in the Official Gazette.

## Article VII — The Treasury
1. Every new citizen receives a grant of ${N.citizenshipGrant} ${C.plural}, minted on the issue of their passport.
2. No ${C.name} may be created except by grant under law. All movements are recorded on a public, tamper-evident ledger.

## Article VIII — Amendment
This Constitution may be amended by a bill that passes the national vote with two thirds of votes cast in favour.`;

const ACTS = [
  ['Act 2026-01', 'Citizenship and Identity Act', 'citizenship',
    'Sets out how a person proves who they are, how duplicate accounts are prevented, and how passports and .access keys are issued and revoked.',
    `## 1. Application
An applicant must (a) verify an email address, (b) submit a photograph of a government-issued identity document, and (c) take a live selfie while performing a randomly generated liveness prompt.

## 2. Uniqueness
1. The Department stores a keyed one-way fingerprint (HMAC) of each identity document number, never the number itself.
2. A document fingerprint that already backs a pending, approved or banned application cannot be used again.
3. Matching names and dates of birth, shared networks and similar selfies are flagged to the reviewer.
4. Knowingly creating a second account is grounds for permanent loss of citizenship.

## 3. Passport
On approval the applicant's browser creates a personal key pair. The private key is encrypted with the citizen's password into a **.access file** that only the citizen holds. The Department signs a passport that carries the public key fingerprint.

## 4. Security levels
1. *Standard:* sign-in with account name and password.
2. *Elevated:* additionally upload the passport image, which is checked for the Department's signature. Elevation lasts ${SECURITY.passportElevationSeconds / 60} minutes.
3. *Ultra-secure:* scan the .access file. It is decrypted in the citizen's own browser, signs a challenge bound to the rotating server key and to the exact action, and is then confirmed with account name and password.

## 5. Lost keys
A citizen who loses their .access file may request a reissue. When it is approved, a new key is generated and every earlier passport image stops working.`],
  ['Act 2026-02', `${C.name} Currency Act`, 'treasury',
    `Establishes the ${C.name} as the sole currency of ${N.short}, a collectible token with fixed issuance and a public ledger.`,
    `## 1. Nature of the ${C.name}
Each ${C.name} is a unique, serially numbered token. Its rarity — common, uncommon, rare, epic or legendary — is fixed forever by its serial number.

## 2. Issuance
${N.citizenshipGrant} ${C.plural} are minted to each citizen when their first passport is issued. No other minting is permitted.

## 3. Transfers
A transfer must be signed with the sender's .access key. By default a wallet spends its commonest ${C.plural} first so collectibles are kept; a citizen may also choose exactly which ${C.plural} to send.

## 4. The Ledger
Every mint, transfer and escrow movement is appended to a public ledger. Each entry includes the hash of the one before and is signed by the Treasury, so any alteration is detectable by anyone.`],
  ['Act 2026-03', 'Marketplace Commerce Act', 'commerce',
    'Governs listings, payments, escrow and disputes in the national marketplace.',
    `## 1. Listings
Any citizen who has passed a passport check may list goods or services priced in ${C.plural}. Listings must be honest and lawful.

## 2. Escrow
Payment is held in escrow when an order is placed. It is released to the seller when the buyer confirms receipt, or refunded if the seller cancels.

## 3. Disputes
A buyer may open a dispute before confirming receipt. The Department of Commerce rules on disputes and its ruling moves the escrowed ${C.plural}.

## 4. Prohibited items
Weapons, illegal goods, stolen property, personal data of others, and anything unlawful where buyer or seller lives.`],
  ['Act 2026-04', 'Public Forum Conduct Act', 'justice',
    'Protects free expression in the Public Forum while prohibiting harassment, spam and fraud.',
    `## 1. Freedom of expression
Citizens may discuss any subject, including criticism of the government.

## 2. Prohibited conduct
Harassment, threats, hate directed at people for who they are, doxxing, spam, impersonation and fraud.

## 3. Moderation
Officials may remove content that breaks this Act and must log the action. Removals can be appealed to the Supreme Tribunal.`],
  ['Act 2026-05', 'Public Records Act', 'records',
    'Makes government records public by default and gives every citizen the right to request records.',
    `## 1. Open by default
The Citizen Registry (account name, display name, passport number, key fingerprint), the Official Gazette, the Ledger and all legislation are public.

## 2. Private by law
Identity documents, selfies, dates of birth, email addresses and legal names are never published.

## 3. Requests
Any citizen may request a record. The responsible department must publish its response, granting or refusing it with reasons.`],
];

const NEWS = [
  ['announcement', 'communications', `${N.name} opens its borders to its first citizens`, `Applications for citizenship are now open. Every verified citizen receives a passport, a personal .access key and ${N.citizenshipGrant} ${C.plural}.`,
    `Today the ${N.name} formally opens for citizenship.\n\nTo join, create an account, verify your email, and submit an identity document together with a live selfie. Once the Department of Citizenship & Identity approves your application, your browser will generate your personal **.access key** and you will be issued a digital passport.\n\nEvery new citizen receives **${N.citizenshipGrant} ${C.plural}**, the national collectible currency, which can be spent in the Marketplace or sent to other citizens.\n\nWelcome to ${N.short}.`, 1],
  ['security', 'digital', 'How your .access key protects you', 'The private key in your .access file never leaves your device. Here is how the rotating server key and challenge signing work.',
    `For the most sensitive actions — sending ${C.plural}, buying in the Marketplace, voting, and changing your password — ${N.short} asks you to scan your **.access file**.\n\n- Your browser decrypts the file with your password. The decrypted text becomes your signing key.\n- The server issues a challenge bound to its **rotating key** (it changes every ${SECURITY.epochSeconds / 60} minutes) and to the exact details of what you are doing.\n- Your key signs the challenge; then you confirm with your account name and password.\n\nBecause the challenge includes the exact amount, recipient or vote, nobody can reuse your signature for anything else, and it expires when the server key rotates.\n\n**Keep your .access file somewhere safe and backed up.** The government cannot recover it for you.`, 0],
  ['economy', 'treasury', `The ${C.name}: every coin a collectible`, `Each ${C.name} carries a serial number and a permanent rarity. Legendary ${C.plural} occur roughly once in every 500.`,
    `The ${C.name} (${C.symbol}) is not an ordinary currency. Each one is minted with a unique serial number, and its rarity is decided forever by that serial:\n\n- **Common**: most ${C.plural}\n- **Uncommon**: about 1 in 6\n- **Rare**: about 1 in 20\n- **Epic**: about 1 in 100\n- **Legendary**: about 1 in 500\n\nWhen you pay, your wallet spends commons first, so your collectibles stay with you unless you choose to send them. The full ledger is public under Public Records.`, 0],
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
    q.run('INSERT INTO laws (code, title, kind, summary, body, enacted_at, department_id) VALUES (?,?,?,?,?,?,?)', 'Constitution', `Constitution of the ${N.name}`, 'constitution',
      'The supreme law: citizenship, rights, the Assembly, the Head of State, the Tribunal and the Treasury.', CONSTITUTION, t, dept('assembly'));
    for (const [code, title, d, summary, body] of ACTS) q.run('INSERT INTO laws (code, title, kind, summary, body, enacted_at, department_id) VALUES (?,?,?,?,?,?,?)', code, title, 'act', summary, body, t, dept(d));
    NEWS.forEach(([category, d, title, summary, body, pinned], i) => q.run('INSERT INTO news (title, summary, body, category, department_id, published_at, pinned) VALUES (?,?,?,?,?,?,?)', title, summary, body, category, dept(d), t - i * 3600e3, pinned));
    FORUM.forEach(([slug, name, description, official], i) => q.run('INSERT INTO forum_categories (slug, name, description, sort, official_only) VALUES (?,?,?,?,?)', slug, name, description, i, official));
    gazette('founding', `The ${N.name} is founded`, `The Constitution and Acts 2026-01 to 2026-05 enter into force.`, null);
  });
  console.log('[seed] departments, constitution, acts, news and forum created');
}
