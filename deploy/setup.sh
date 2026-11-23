#!/usr/bin/env bash
# Installs or updates Domus on an Ubuntu 22.04/24.04 server (x86-64 or ARM, e.g. the Oracle
# Cloud Always Free VM). Run as root from the folder holding domus.tar.gz:
#
#   sudo bash setup.sh [your.domain]
#
# Without a domain it uses <public-ip>.sslip.io, a free name that points at this server.
# Re-running it with a newer domus.tar.gz updates the code and keeps all data.
set -euo pipefail

APP=/opt/domus
DATA=/var/lib/domus
ENV_FILE=/etc/domus.env
TARBALL="$(pwd)/domus.tar.gz"
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
[ -f "$TARBALL" ] || { echo "domus.tar.gz not found in $(pwd)"; exit 1; }

DOMAIN="${1:-}"
# Updating without a domain keeps the one already in use.
if [ -z "$DOMAIN" ] && [ -f "$ENV_FILE" ]; then
  DOMAIN="$(sed -n 's#^PUBLIC_URL=https://##p' "$ENV_FILE")"
fi
if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS4 https://ifconfig.me)"
  DOMAIN="${IP//./-}.sslip.io"
fi
echo "==> Domain: $DOMAIN"

# Small machines (e.g. the 1 GB E2.1.Micro) get 2 GB of swap so installs and the chain fit.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q /swapfile; then
  echo "==> Adding 2 GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Packages (Node.js 22, Caddy)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https
if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi

echo "==> Code"
id domus >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin domus
mkdir -p "$APP" "$DATA"
# Replace the code (data lives in $DATA and is never touched).
find "$APP" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
tar -xzf "$TARBALL" -C "$APP"
(cd "$APP" && npm ci --omit=dev --no-audit --no-fund)
chown -R root:root "$APP"
chown -R domus:domus "$DATA"
chmod 700 "$DATA"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<CONF
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATA_DIR=$DATA
PUBLIC_URL=https://$DOMAIN
# Real email for verification codes, e.g. a Gmail app password:
# SMTP_URL=smtps://you%40gmail.com:app-password@smtp.gmail.com:465
# MAIL_FROM=Domus <you@gmail.com>
CONF
  chmod 600 "$ENV_FILE"
else
  # Keep the settings, but follow a change of domain.
  sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAIN#" "$ENV_FILE"
fi

echo "==> Service"
cat > /etc/systemd/system/domus.service <<UNIT
[Unit]
Description=Domus online nation
After=network-online.target
Wants=network-online.target

[Service]
User=domus
WorkingDirectory=$APP
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

# `sudo domus-admin <username> --approve` makes the founding Head of State.
cat > /usr/local/bin/domus-admin <<'ADMIN'
#!/usr/bin/env bash
set -a; . /etc/domus.env; set +a
cd /opt/domus && exec sudo -E -u domus node --no-warnings=ExperimentalWarning scripts/make-admin.js "$@"
ADMIN
chmod 755 /usr/local/bin/domus-admin

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY

echo "==> Firewall (ports 80 and 443)"
# Oracle's Ubuntu images reject everything but SSH in iptables, even once the cloud firewall allows it.
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then ufw allow 80/tcp; ufw allow 443/tcp; fi

systemctl daemon-reload
systemctl enable domus >/dev/null
systemctl restart domus
systemctl restart caddy

sleep 8
if systemctl is-active --quiet domus; then
  echo
  echo "Domus is running at https://$DOMAIN"
  echo "  logs:                         journalctl -u domus -f"
  echo "  settings:                     sudo nano $ENV_FILE, then sudo systemctl restart domus"
  echo "  make yourself Head of State:  sudo domus-admin <username> --approve"
  echo "  back up:                      $DATA (database, server keys, blockchain)"
else
  echo "Domus failed to start:"; journalctl -u domus -n 40 --no-pager; exit 1
fi
