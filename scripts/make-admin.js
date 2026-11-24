// Usage: npm run make-admin -- <username> [--approve]
// Makes an account Head of State (administrator). --approve also fast-tracks a pending
// citizenship application so the founder can issue their own passport and .access key.
import { q, tx, gazette } from '../server/db.js';

const [username, ...flags] = process.argv.slice(2);
if (!username) { console.error('Usage: npm run make-admin -- <username> [--approve]'); process.exit(1); }
const u = q.get('SELECT * FROM users WHERE username = ?', username);
if (!u) { console.error(`No account named "${username}"`); process.exit(1); }

tx(() => {
  const dept = q.get("SELECT id FROM departments WHERE slug = 'president'");
  const hos = q.get("SELECT id FROM positions WHERE level = 'head_of_state'");
  q.run('UPDATE users SET position_id = NULL WHERE position_id = ?', hos?.id ?? -1);
  q.run("UPDATE users SET role = 'admin', department_id = ?, official_title = 'Head of State', position_id = ? WHERE id = ?", dept?.id, hos?.id ?? null, u.id);
  if (flags.includes('--approve') && ['documents', 'review', 'rejected'].includes(u.status)) {
    const a = q.get("SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC LIMIT 1", u.id);
    if (a) q.run("UPDATE applications SET status = 'approved', review_note = 'Founding approval', reviewed_at = ? WHERE id = ?", Date.now(), a.id);
    q.run("UPDATE users SET status = 'approved', email_verified = 1, photo_path = ? WHERE id = ?", a?.selfie_image ?? null, u.id);
    console.log('Citizenship approved — sign in and open the Passport page to issue your passport and .access key.');
  }
  gazette('appointment', `@${u.username} appointed Head of State`, '', `user:${u.id}`);
});
console.log(`@${u.username} is now Head of State (admin).`);
