#!/usr/bin/env bash
# Run ON the droplet as root, once. Installs Node 22, Caddy (HTTPS), a firewall, a service user and the systemd unit.
#   bash /opt/ad-agents/deploy/setup-droplet.sh <public-hostname>     e.g. 203.0.113.10.sslip.io
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
HOST="${1:?usage: setup-droplet.sh <public-hostname>}"
APP=/opt/ad-agents

apt-get update -q
apt-get install -y -q ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

# Node 22 LTS from NodeSource
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

# Caddy (automatic HTTPS)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

# Service user and directories
id -u adagents >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin adagents
mkdir -p "$APP"/{data,logs}
chown -R adagents:adagents "$APP"

# Firewall: SSH + HTTP/HTTPS only
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# Caddy config
sed "s/__HOST__/${HOST}/" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

# App service (it starts properly once deploy.sh has copied .env)
cp "$APP/deploy/ad-agents.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable ad-agents
echo "setup done: node $(node -v), caddy $(caddy version | cut -d' ' -f1), host ${HOST}. Now run deploy/deploy.sh from your computer."
