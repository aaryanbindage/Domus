// Usage: domus-verify <username> --name "Legal Name" --dob YYYY-MM-DD [--country US] [--guardian "Parent Name"]
// Approves citizenship for someone a registrar has met in person, with no document or selfie
// uploaded. The one-person-one-account check still runs on name + date of birth, and the
// approval is recorded in the audit log. Under 13, a parent or guardian must be present and named.
import { q, tx, audit } from '../server/db.js';
import { identityHmac } from '../server/security.js';

const args = process.argv.slice(2);
const username = args[0]?.replace(/^@/, '');
const opt = (k) => { const i = args.indexOf(`--${k}`); return i > 0 ? args[i + 1] : undefined; };
const fail = (m) => { console.error(m); process.exit(1); };
const name = opt('name')?.trim(), dob = opt('dob'), country = opt('country') || 'In person', guardian = opt('guardian')?.trim();
if (!username || !name || !dob) fail('Usage: domus-verify <username> --name "Legal Name" --dob YYYY-MM-DD [--country US] [--guardian "Parent Name"]');
if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(Date.parse(dob))) fail('--dob must look like 2012-05-31');
if (name.split(/\s+/).length < 2) fail('--name needs a first and last name');
const age = (Date.now() - Date.parse(dob)) / (365.25 * 864e5);
if (!(age > 0 && age < 125)) fail('That date of birth is not plausible');
if (age < 13 && !guardian) fail('Under 13: their parent or guardian must be there with you. Add --guardian "Parent Name"');

const u = q.get('SELECT * FROM users WHERE username = ?', username);
if (!u) fail(`No account named "${username}"`);
if (['approved', 'citizen'].includes(u.status)) fail(`@${username} is already ${u.status === 'citizen' ? 'a citizen' : 'approved'}`);
if (u.status === 'banned') fail(`@${username} is banned`);
if (!u.email_verified) fail(`@${username} has not verified their email yet: they should do that first on the site`);

const personHmac = identityHmac('person', name, dob);
const dup = q.get("SELECT u.username FROM applications a JOIN users u ON u.id = a.user_id WHERE a.person_hmac = ? AND a.user_id != ? AND a.status IN ('pending','approved','banned')", personHmac, u.id);
if (dup) fail(`Someone with that name and date of birth already has an account (@${dup.username}). One person, one account.`);

const ts = Date.now();
tx(() => {
  q.run("UPDATE applications SET status = 'rejected', review_note = 'Replaced by in-person verification', reviewed_at = ? WHERE user_id = ? AND status = 'pending'", ts, u.id);
  q.run(`INSERT INTO applications (user_id, legal_name, dob, country, doc_type, doc_hmac, doc_last4, person_hmac, doc_image, selfie_image, live_capture, liveness_phrase, flags,
      status, review_note, created_at, reviewed_at, guardian_name, guardian_consent_at)
    VALUES (?,?,?,?,'in_person',?,'',?,'','',0,'',?, 'approved', 'Verified in person by a registrar', ?,?,?,?)`,
  u.id, name, dob, country, identityHmac('in_person', String(u.id)), personHmac,
  JSON.stringify([{ code: 'in_person', detail: 'Verified face to face; no document or selfie on file' }]), ts, ts, guardian ?? null, guardian ? ts : null);
  q.run("UPDATE users SET status = 'approved', legal_name = ?, dob = ? WHERE id = ?", name, dob, u.id);
});
audit(null, 'verified_in_person', { user: u.id, guardian: guardian ?? undefined });
console.log(`@${username} is approved. They can now sign in and open the Passport page to issue their passport and .access key.`);
