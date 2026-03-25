#!/bin/bash
# ──────────────────────────────────────────────
# Build & Push Cortex Hub images to GHCR
# Run from repository root: D:\Python\projects\cortex-hub
# ──────────────────────────────────────────────
set -euo pipefail

REGISTRY="ghcr.io/ngojclee"
TAG="${1:-latest}"
COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "🔨 Building Cortex Hub images..."
echo "   Registry:   $REGISTRY"
echo "   Tag:        $TAG"
echo "   Commit:     $COMMIT_SHA"
echo "   Date:       $BUILD_DATE"
echo ""

# 1. Build Dashboard API (includes API server + dashboard web static)
echo "📦 [1/3] Building cortex-api..."
docker build \
  -f infra/Dockerfile.dashboard-api \
  --build-arg COMMIT_SHA="$COMMIT_SHA" \
  --build-arg BUILD_DATE="$BUILD_DATE" \
  -t "$REGISTRY/cortex-api:$TAG" \
  -t "$REGISTRY/cortex-api:$COMMIT_SHA" \
  .

echo "✅ cortex-api built"

# 2. Build MCP Server
echo "📦 [2/3] Building cortex-mcp..."
docker build \
  -f infra/Dockerfile.hub-mcp \
  -t "$REGISTRY/cortex-mcp:$TAG" \
  -t "$REGISTRY/cortex-mcp:$COMMIT_SHA" \
  .

echo "✅ cortex-mcp built"

# 3. Build GitNexus
echo "📦 [3/3] Building cortex-gitnexus..."
docker build \
  -f infra/Dockerfile.gitnexus \
  -t "$REGISTRY/cortex-gitnexus:$TAG" \
  -t "$REGISTRY/cortex-gitnexus:$COMMIT_SHA" \
  .

echo "✅ cortex-gitnexus built"

echo ""
echo "🚀 Pushing to GHCR..."

docker push "$REGISTRY/cortex-api:$TAG"
docker push "$REGISTRY/cortex-api:$COMMIT_SHA"
echo "  ✅ cortex-api pushed"

docker push "$REGISTRY/cortex-mcp:$TAG"
docker push "$REGISTRY/cortex-mcp:$COMMIT_SHA"
echo "  ✅ cortex-mcp pushed"

docker push "$REGISTRY/cortex-gitnexus:$TAG"
docker push "$REGISTRY/cortex-gitnexus:$COMMIT_SHA"
echo "  ✅ cortex-gitnexus pushed"

echo ""
echo "🎉 All images pushed to $REGISTRY"
echo ""
echo "Images built:"
echo "  $REGISTRY/cortex-api:$TAG"
echo "  $REGISTRY/cortex-mcp:$TAG"
echo "  $REGISTRY/cortex-gitnexus:$TAG"
echo ""
echo "Next: On your server, redeploy the stack in Portainer to pull latest images."
echo "      Watchtower will also auto-pull within 5 minutes if running."
