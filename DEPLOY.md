# Putting Domus online for free

Domus needs a server that keeps its disk: the database, the server keys and the blockchain all live there. Free tiers that sleep or wipe the disk on restart (Render's free web services, for example) would lose every citizen. A free virtual machine doesn't have that problem.

**Recommended: Oracle Cloud Always Free.** You get a real Ubuntu server with a persistent disk, free with no time limit. In 2026 Oracle reportedly halved the free ARM allowance to 2 CPUs and 12 GB of memory. That is still far more than Domus needs.

## 1. Create the server (in your browser, about 15 minutes)

1. Sign up at <https://www.oracle.com/cloud/free/>.
   - Oracle asks for a card to verify you're a person. Always Free resources are not charged unless you upgrade the account.
   - Pick a home region close to you. It can't be changed later.
2. Go to **Compute → Instances → Create instance**.
   - **Image:** Canonical Ubuntu 24.04.
   - **Shape:** Ampere `VM.Standard.A1.Flex` with 1 OCPU and 6 GB, marked *Always Free eligible*.
     - If Ampere says "out of capacity", try again later or pick another availability domain.
     - The x86 `VM.Standard.E2.1.Micro` is also free but has only 1 GB of memory, which is tight.
   - **SSH keys:** choose *Generate a key pair* and **download the private key**.
   - Create the instance and copy its **public IP address**.
3. Open the web ports in Oracle's cloud firewall:
   - Go to **Instance → Subnet → Security list → Add ingress rules**.
   - Add source `0.0.0.0/0`, TCP, destination port `80`.
   - Add the same rule again for port `443`.

## 2. Deploy (from this folder, in PowerShell)

```powershell
.\deploy\deploy.ps1 -Server ubuntu@YOUR.IP.ADDRESS -Key C:\path\to\ssh-key.key
```

The script uploads the committed code and runs `deploy/setup.sh` on the server, which does the following:
- Installs Node.js 22 and Caddy.
- Runs Domus as a background service that restarts itself.
- Gets a free HTTPS certificate.
- Opens the server's own firewall.

When it finishes it prints your address, which looks like `https://203-0-113-7.sslip.io`. sslip.io is a free name that points at your IP, so you don't need to buy a domain. To use a domain you own, point it at the IP first, then add `-Domain your.domain` to the command.

Run the same command again to update: it replaces the code and keeps every citizen, Sigil and law.

## 3. Turn on email (so people can sign up)

Applicants must receive a 6-digit code by email. Until email is set up, codes are only written to the server log (`journalctl -u domus -f`).

A free option is a Gmail account:
1. Turn on 2-Step Verification.
2. Create an **App password** at <https://myaccount.google.com/apppasswords>.
3. On the server, open the settings file:

```bash
ssh -i C:\path\to\ssh-key.key ubuntu@YOUR.IP.ADDRESS
sudo nano /etc/domus.env
```

4. Uncomment and fill in these two lines. Write the `@` in your address as `%40`:

```
SMTP_URL=smtps://you%40gmail.com:your-app-password@smtp.gmail.com:465
MAIL_FROM=Domus <you@gmail.com>
```

5. Restart Domus with `sudo systemctl restart domus`.

### If Gmail refuses the app password: use OAuth

Google sometimes rejects app passwords with "Username and Password not accepted". OAuth avoids app passwords entirely.

1. Go to <https://console.cloud.google.com/>, signed in as the Gmail account Domus should send from, and create a project such as `Domus`.
2. Go to **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen** (also labelled **Google Auth Platform**).
   - Choose **External**.
   - App name: `Domus`.
   - Enter your email as the support and developer contact.
   - Save.
4. Under **Audience**, click **Publish app** so the app is *In production*.
   - In *Testing* mode Google expires the authorisation after 7 days.
   - Google shows a warning that the app is unverified. That's fine for your own account.
5. Go to **Credentials → Create credentials → OAuth client ID** and choose **Desktop app**. Copy the **Client ID** and **Client secret**.
6. On your PC, in this folder, run:
   ```powershell
   npm run gmail-oauth -- CLIENT_ID CLIENT_SECRET
   ```
   - A Google page opens. Sign in, click **Advanced → Go to Domus (unsafe)** (it's your own app), and allow access.
   - The command prints four `GMAIL_…` lines.
7. Put those four lines in `/etc/domus.env` on the server and restart Domus. Delete or comment out any `SMTP_URL` line. The log then shows `[mail] mail server login OK`.

## 4. Become the founding Head of State

Sign up on the live site and submit your ID and selfie. Then, on the server, run:

```bash
sudo domus-admin YOUR-USERNAME --approve
```

Open **My passport**, issue it, and download your `.access` file.

## Looking after it

| Task | Command (on the server) |
|---|---|
| Live logs | `journalctl -u domus -f` |
| Restart | `sudo systemctl restart domus` |
| Settings | `sudo nano /etc/domus.env` |
| Back up everything | `sudo tar -czf domus-backup.tgz /var/lib/domus`, then copy it off with `scp` |

`/var/lib/domus` holds everything: the database, `server-keys.json`, and the blockchain with the Treasury key in `chain.json`. Back it up regularly and keep it private. Losing it means losing the nation; leaking it means someone could forge passports.

The blockchain stays the embedded one stored on the server. To move it to a public test network, see *The blockchain* in the README and add `CHAIN_RPC`/`CHAIN_PRIVATE_KEY` to `/etc/domus.env`.

## Other free options

- **Your own PC plus a Cloudflare Tunnel.** This is free and needs no cloud account, but the nation is offline whenever the PC is off.
- **Google Cloud e2-micro (always free).** It works, but it has 1 GB of memory and needs a card as well.
