#!/usr/bin/env bash
set -euo pipefail

# Deploy N-Tutor to DigitalOcean droplet
# Usage: ./scripts/deploy.sh
#
# Builds Docker images locally, pushes to GHCR, then
# SSHs into the droplet to pull + restart.
#
# Requires GHCR_TOKEN in .env.production

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load env vars from .env.production
if [ -f "$ROOT_DIR/.env.production" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.production"
  set +a
fi

REGISTRY="ghcr.io"
REPO="rnadela/n-tutor"
API_IMAGE="$REGISTRY/$REPO/api"
WEB_IMAGE="$REGISTRY/$REPO/web"
TAG="$(git rev-parse --short HEAD)"

SSH_KEY="${SSH_KEY:-$HOME/.ssh/n-tutor_deploy}"
SSH_HOST="deploy@${DROPLET_IP:?Set DROPLET_IP env var}"

echo "==> Pushing code to origin..."
git push origin main

echo "==> Logging in to GHCR..."
echo "${GHCR_TOKEN:?Set GHCR_TOKEN env var}" | docker login ghcr.io -u rnadela --password-stdin

echo "==> Building API image (linux/amd64)..."
docker build --platform linux/amd64 -f infra/docker/api.Dockerfile \
  -t "$API_IMAGE:$TAG" -t "$API_IMAGE:latest" .

echo "==> Building Web image (linux/amd64)..."
docker build --platform linux/amd64 -f infra/docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.n-tutor.ralphnadela.com/api \
  -t "$WEB_IMAGE:$TAG" -t "$WEB_IMAGE:latest" .

echo "==> Pushing images to GHCR..."
docker push "$API_IMAGE:$TAG"
docker push "$API_IMAGE:latest"
docker push "$WEB_IMAGE:$TAG"
docker push "$WEB_IMAGE:latest"

echo "==> Cleaning up local images..."
docker image prune -af --filter "until=24h" 2>/dev/null || true

echo "==> Syncing prod compose file..."
# Source of truth for prod compose lives at compose.production.yml in the repo.
scp -i "$SSH_KEY" "$ROOT_DIR/compose.production.yml" "$SSH_HOST:/opt/ntutor/docker-compose.yml"

echo "==> Syncing prod Caddyfile..."
scp -i "$SSH_KEY" "$ROOT_DIR/infra/docker/Caddyfile" "$SSH_HOST:/opt/ntutor/Caddyfile"

echo "==> Deploying to droplet..."
ssh -i "$SSH_KEY" "$SSH_HOST" bash -s "$API_IMAGE:$TAG" "$WEB_IMAGE:$TAG" <<'REMOTE'
set -euo pipefail
API_TAG="$1"
WEB_TAG="$2"
cd /opt/ntutor

echo "Pulling new images..."
docker pull "$API_TAG"
docker pull "$WEB_TAG"

echo "Updating .env..."
sed -i "s|API_IMAGE=.*|API_IMAGE=$API_TAG|" .env
sed -i "s|WEB_IMAGE=.*|WEB_IMAGE=$WEB_TAG|" .env

echo "Running migrations..."
docker compose run --rm -T api sh -c "cd /app/apps/api && npx prisma@7 migrate deploy" < /dev/null

echo "Deploying..."
docker compose up -d --remove-orphans

echo "Reloading Caddy (in case Caddyfile changed)..."
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>&1 || \
  docker compose restart caddy

echo "Cleaning up..."
docker image prune -a -f

echo "Health check (polling, up to 90s)..."
deadline=$((SECONDS + 90))
api_ok=0
web_ok=0
while [ $SECONDS -lt $deadline ]; do
  if [ $api_ok -eq 0 ] && docker compose exec -T api wget -qO- http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "  API: OK"
    api_ok=1
  fi
  if [ $web_ok -eq 0 ] && docker compose exec -T web wget -qO- http://localhost:3000 > /dev/null 2>&1; then
    echo "  Web: OK"
    web_ok=1
  fi
  [ $api_ok -eq 1 ] && [ $web_ok -eq 1 ] && break
  sleep 3
done
if [ $api_ok -eq 0 ] || [ $web_ok -eq 0 ]; then
  echo "  Health check FAILED (api=$api_ok web=$web_ok) after 90s"
  exit 1
fi

echo "Deploy complete!"
REMOTE
