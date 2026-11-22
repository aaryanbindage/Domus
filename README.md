# Republic of Veridia — an online nation

A complete government platform for a nation that exists online:

- **Citizenship**: sign up, verify your email, prove you're a real person (ID document plus a live webcam selfie with a random liveness prompt), human review, then passport issuance.
- **One person, one account**: each identity document is stored only as a keyed HMAC fingerprint, and the database won't let the same document back two accounts. Reviewers also see flags for matching name and date of birth, a shared network, or a similar selfie.
- **Digital passport**: an SVG passport (photo, MRZ, QR verification code) with an Ed25519-signed token embedded in it. The PNG export carries the same token in a `tEXt` chunk.
- **Encrypted `.access` key file**: your browser generates an ECDSA P-256 key. The private key is encrypted with AES-256-GCM using your password (PBKDF2, 600k rounds). The server only ever sees the public key.
- **Three security levels**

  | Level | Proof | Used for |
  |---|---|---|
  | Standard | account name + password | browsing, forum, messages |
  | Elevated | passport image upload (signature checked, 15 min) | listing items, bills, records requests, profile, confirming deliveries, reviewing applications |
  | Ultra-secure | `.access` file decrypted in the browser → signs a challenge bound to the **rotating server key** (5-min epochs) and to the exact action → then account name + password | sending Sigils, buying, voting, password change, appointments, suspensions |

- **Government portal**: news, 12 departments, Constitution plus 5 Acts, citizen bills (signatures → national vote → Head of State assent → statute book), public records (citizen registry, Official Gazette, treasury, records requests, passport verification).
- **Sigil (SGL) currency**: 1,000 numbered collectible tokens are minted to each new citizen, with rarities from common to legendary. Every movement is recorded on a hash-chained, server-signed public ledger, and citizen transfers also carry the citizen's own signature. Anyone can re-verify the whole chain.
- **Marketplace**: a separate area with listings, photos, search and filters, escrow, delivery, disputes ruled by the Department of Commerce, and seller ratings.
- **Public forum**: categories, threads, replies, likes, quoting, reports and moderation.

## Run it

Requires Node 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install
npm start                 # http://localhost:3000
```

1. Open the site and choose **Become a citizen**. In development the email code is shown on the page and printed in the server console.
2. Submit your ID and selfie, then make yourself the founding Head of State:
   ```bash
   npm run make-admin -- <your-username> --approve
   ```
3. Open **My passport**, generate your key, and **download the `.access` file**. It can't be recovered.
4. As admin you can now review other applicants (Government console) and appoint officials. Officials in the Department of Citizenship can also review.

`npm test` runs a 41-check end-to-end test of the whole lifecycle against a throwaway database. It covers duplicate-document refusal, forged and foreign passports, parameter tampering, replayed challenges, wrong passwords, escrow, voting and ledger verification.

## Configuration

| Env var | Default |
|---|---|
| `PORT` | `3000` |
| `DATA_DIR` | `./data` (SQLite DB, server keys, uploads) |
| `PUBLIC_URL` | `http://localhost:PORT` (used in passport QR codes) |
| `NATION_NAME`, `NATION_SHORT`, `NATION_DEMONYM`, `NATION_CODE`, `NATION_MOTTO` | Republic of Veridia… |
| `BILL_SIGNATURES`, `BILL_VOTING_DAYS` | `3`, `7` |
| `NODE_ENV=production` | hides dev email codes |

`data/server-keys.json` holds the rotating-key master secret, the document-HMAC pepper and the Ed25519 passport and ledger signing key. Back it up and keep it secret.

## What is and isn't proven

- "Real person" verification is **document + live selfie + human review**. It's strong against casual multi-accounting but isn't a KYC provider. For production, plug a provider such as Stripe Identity or Persona into `POST /api/account/application`.
- Document uniqueness is enforced cryptographically. A determined fraudster using *different real documents* is what the reviewer flags are for.
- The selfie similarity hash is a weak signal, not face recognition.
- Email sending is a stub (`sendEmailCode` in `server/routes/account.js`); connect SMTP before going live.
- Run behind HTTPS in production. Cookies become `Secure` automatically when they're served over TLS.
