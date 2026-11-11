#!/usr/bin/env bash
# Run on your computer: sync the project to the droplet and restart the service.
#   deploy/deploy.sh <droplet-ip>        (or: npm run deploy:droplet -- <droplet-ip>)
# Your local .env IS copied (mode 600): the droplet runs with the same settings as your computer.
# Other .env.* files never leave your computer.
set -euo pipefail
IP="${1:?usage: deploy/deploy.sh <droplet-ip>}"
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env here: copy .env.example to .env and fill it in first"; exit 1; }
rsync -az --delete \
  --exclude node_modules --exclude test-output --exclude data --exclude logs --exclude .git --exclude '.env.*' \
  ./ "root@${IP}:/opt/ad-agents/"
ssh "root@${IP}" 'cd /opt/ad-agents && npm ci --omit=dev --silent && chown -R adagents:adagents /opt/ad-agents && chmod 600 .env && systemctl restart ad-agents && sleep 2 && systemctl is-active ad-agents && tail -3 logs/server.log'
