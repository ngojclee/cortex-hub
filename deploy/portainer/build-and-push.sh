#!/bin/bash
# ──────────────────────────────────────────────
# Cortex Hub — Build, Push & Redeploy (one-shot)
# Copy-paste this entire script on your Docker server.
# ──────────────────────────────────────────────
set -euo pipefail

REGISTRY="ghcr.io/ngojclee"
TAG="latest"
REPO_URL="https://github.com/ngojclee/cortex-hub.git"
WORK_DIR="${HOME}/cortex-hub"

echo "═══════════════════════════════════════════════"
echo "  Cortex Hub — Build & Push to GHCR"
echo "═══════════════════════════════════════════════"

# ── Step 1: Clone or pull ─────────────────────
if [ -d "$WORK_DIR/.git" ]; then
  echo "📥 Pulling latest code..."
  cd "$WORK_DIR"
  git pull origin master
else
  echo "📥 Cloning repo..."
  git clone "$REPO_URL" "$WORK_DIR"
  cd "$WORK_DIR"
fi

COMMIT_SHA=$(git rev-parse --short HEAD)
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "   Commit: $COMMIT_SHA"
echo "   Date:   $BUILD_DATE"
echo ""

# ── Step 2: Check GHCR login ─────────────────
echo "🔑 Checking GHCR login..."
if ! docker pull ghcr.io/ngojclee/cortex-api:latest 2>/dev/null; then
  echo ""
  echo "⚠️  Not logged in to GHCR. Run this first:"
  echo "   echo YOUR_GITHUB_PAT | docker login ghcr.io -u ngojclee --password-stdin"
  echo ""
  read -p "Press Enter after logging in, or Ctrl+C to abort... "
fi

# ── Step 3: Build all images ──────────────────
echo ""
echo "🔨 [1/3] Building cortex-api (Dashboard API + Web)..."
docker build \
  -f infra/Dockerfile.dashboard-api \
  --build-arg COMMIT_SHA="$COMMIT_SHA" \
  --build-arg BUILD_DATE="$BUILD_DATE" \
  -t "$REGISTRY/cortex-api:$TAG" \
  -t "$REGISTRY/cortex-api:$COMMIT_SHA" \
  .
echo "   ✅ cortex-api built"

echo ""
echo "🔨 [2/3] Building cortex-mcp (MCP Gateway)..."
docker build \
  -f infra/Dockerfile.hub-mcp \
  -t "$REGISTRY/cortex-mcp:$TAG" \
  -t "$REGISTRY/cortex-mcp:$COMMIT_SHA" \
  .
echo "   ✅ cortex-mcp built"

echo ""
echo "🔨 [3/3] Building cortex-gitnexus (Code Intelligence)..."
docker build \
  -f infra/Dockerfile.gitnexus \
  -t "$REGISTRY/cortex-gitnexus:$TAG" \
  -t "$REGISTRY/cortex-gitnexus:$COMMIT_SHA" \
  .
echo "   ✅ cortex-gitnexus built"

# ── Step 4: Push all images ───────────────────
echo ""
echo "🚀 Pushing images to GHCR..."

docker push "$REGISTRY/cortex-api:$TAG"
docker push "$REGISTRY/cortex-api:$COMMIT_SHA"
echo "   ✅ cortex-api:$TAG pushed"

docker push "$REGISTRY/cortex-mcp:$TAG"
docker push "$REGISTRY/cortex-mcp:$COMMIT_SHA"
echo "   ✅ cortex-mcp:$TAG pushed"

docker push "$REGISTRY/cortex-gitnexus:$TAG"
docker push "$REGISTRY/cortex-gitnexus:$COMMIT_SHA"
echo "   ✅ cortex-gitnexus:$TAG pushed"

# ── Done ──────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ All 3 images pushed to GHCR!"
echo ""
echo "  Images:"
echo "     $REGISTRY/cortex-api:$TAG"
echo "     $REGISTRY/cortex-mcp:$TAG"
echo "     $REGISTRY/cortex-gitnexus:$TAG"
echo ""
echo "  Next steps:"
echo "     1. Portainer → Stacks → cortex-hub → Redeploy"
echo "        (or wait 5 min for Watchtower auto-pull)"
echo "     2. Cloudflare Access: bypass policy for /mcp"
echo "     3. Test: curl https://cortexhub.lengoc.me/health"
echo "═══════════════════════════════════════════════"
