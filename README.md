# Domus — an online nation

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

- **Statute book**: 70 founding instruments (the Constitution, 59 Acts, 7 Regulations, 3 Executive Orders) across 12 areas of law: criminal code, sanctions, due process, courts, consumer protection, data protection, currency, Mint exchange, elections, ethics, foreign affairs and more. They live in `server/laws.js` and are synced into the database on every start; laws enacted by citizen vote are never overwritten.
- **Government portal**: news, 12 departments, citizen bills (signatures → national vote → Head of State assent → statute book), public records (citizen registry, Official Gazette, treasury, records requests, passport verification).
- **Sigil (SGL) currency**: 1,000 numbered collectible tokens are minted to each new citizen. Each token's rarity sets its face value:

  | Rarity | Value | Odds |
  |---|---|---|
  | Common | 1 SGL | the rest (~78%) |
  | Uncommon | 2 SGL | 1 in 6 |
  | Rare | 5 SGL | 1 in 21 |
  | Epic | 25 SGL | 1 in 100 |
  | Legendary | 100 SGL | 1 in 500 |

  A grant is worth about 1,790 SGL on average. Balances and prices are in SGL value. Payments are exact and spend the lowest-value tokens first; when exact change isn't possible, the **Mint exchange** breaks a larger token into change automatically. You can also do this by hand from the wallet. Values are set in `server/config.js` (`currency.values`).

  **Sigils live on a blockchain.** Every grant, payment, Mint exchange and escrow movement is a transaction on the `SigilLedger` smart contract (`contracts/SigilLedger.sol`). The server's database mirrors the chain for speed and keeps a hash-chained, server-signed journal that records each transaction hash.
- **Aurum wallet**: built in, with nothing to install. Its secp256k1 key is derived in the browser from the private key inside the citizen's `.access` file, so the `.access` file *is* the wallet. Payments are signed (EIP-712) inside the usual `.access` step, and the Treasury relays them on-chain and pays the gas, so citizens never need ETH or MetaMask.
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

`npm test` runs a 80-check end-to-end test of the whole lifecycle against a throwaway database. It covers duplicate-document refusal, forged and foreign passports, parameter tampering, replayed challenges, wrong passwords, under-13 guardian consent, Council elections and office appointments, escrow, voting, ledger verification, and the on-chain rules (citizen-only transfers, signatures the Treasury cannot forge, rarity parity, chain-vs-ledger audit).

**Putting it online for free:** see [DEPLOY.md](DEPLOY.md) (Oracle Cloud Always Free, one command).

## Configuration

| Env var | Default |
|---|---|
| `PORT` | `3000` |
| `DATA_DIR` | `./data` (SQLite DB, server keys, uploads) |
| `PUBLIC_URL` | `http://localhost:PORT` (used in passport QR codes) |
| `NATION_NAME`, `NATION_SHORT`, `NATION_DEMONYM`, `NATION_CODE`, `NATION_MOTTO` | Domus, Domusian, DMS… |
| `BILL_SIGNATURES`, `BILL_VOTING_DAYS` | `3`, `7` |
| `NODE_ENV=production` | hides dev email codes |
| `HOST` | all interfaces (set `127.0.0.1` behind a reverse proxy) |
| `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Gmail via OAuth (`npm run gmail-oauth`) |
| `SMTP_URL`, `MAIL_FROM` | any SMTP server; with neither, email codes are only logged |

`data/server-keys.json` holds the rotating-key master secret, the document-HMAC pepper and the Ed25519 passport and ledger signing key. Back it up and keep it secret.

## The blockchain

Sigils are real on-chain tokens, but they are built to have **no cash value**:

- **Citizen-only.** The contract tracks owners by citizen number, not by address. A Sigil can only be held by a registered, active citizen, the Treasury reserve or marketplace escrow. It has no `approve`/`transferFrom` and isn't an ERC-20 or ERC-721, so crypto exchanges and NFT marketplaces can't hold or list it.
- **Signed by the citizen.** Moving a citizen's Sigils needs their Aurum signature, which the contract checks. The Treasury can't take Sigils from anyone, and a citizen could submit their own signed payment to the contract directly.
- **Supply rules on-chain.** Exactly one 1,000-Sigil grant per citizen; rarity and face value are computed by the contract from the serial number; the only other minting is Mint change.
- **Auditable.** Public Records compares every Sigil's owner on-chain with the national ledger, and `POST /api/chain/rpc` is a read-only JSON-RPC endpoint any Ethereum tool can query.

What it still trusts: the Treasury key is the contract's *registrar*. It decides who counts as a citizen, which is the point of identity verification, and it can re-key a citizen after a lost-key reissue. Every such action is public on-chain. Nobody can stop a citizen from selling their whole account for cash off-platform; the law forbids it (Prohibited Goods Act).

### Which chain

| Setting | What it is |
|---|---|
| *(default)* | An embedded local Ethereum chain stored in `data/chain`. Free and private to your server. |
| `CHAIN_RPC=https://sepolia.base.org` (or any EVM test network) | A public test network. On first start the server prints the Treasury address and stops if it has no gas: fund it with free test ETH from a faucet, then restart, and the contract deploys itself. Optional: `CHAIN_PRIVATE_KEY`, `CHAIN_NAME`, `CHAIN_EXPLORER`. |

The contract's address per chain and the Treasury key are kept in `data/chain.json`; back it up with `data/server-keys.json`. After editing the contract, run `npm run compile-contract`.

## What is and isn't proven

- "Real person" verification is **document + live selfie + human review**. It's strong against casual multi-accounting but isn't a KYC provider. For production, plug a provider such as Stripe Identity or Persona into `POST /api/account/application`.
- Document uniqueness is enforced cryptographically. A determined fraudster using *different real documents* is what the reviewer flags are for.
- The selfie similarity hash is a weak signal, not face recognition.
- Email sending is a stub (`sendEmailCode` in `server/routes/account.js`); connect SMTP before going live.
- Run behind HTTPS in production. Cookies become `Secure` automatically when they're served over TLS.
