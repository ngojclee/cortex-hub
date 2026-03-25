# Build and Push to GHCR

Run from repository root (`d:/Python/projects/cortex-hub`).

## 1) Login GHCR

```bash
echo YOUR_GITHUB_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

## 2) Build + Push Dashboard API image

```bash
docker build -f infra/Dockerfile.dashboard-api -t ghcr.io/YOUR_GITHUB_USERNAME/cortex-api:2026.03.25 .
docker push ghcr.io/YOUR_GITHUB_USERNAME/cortex-api:2026.03.25
```

## 3) Build + Push MCP image

```bash
docker build -f infra/Dockerfile.hub-mcp -t ghcr.io/YOUR_GITHUB_USERNAME/cortex-mcp:2026.03.25 .
docker push ghcr.io/YOUR_GITHUB_USERNAME/cortex-mcp:2026.03.25
```

## 4) Portainer

- Use `deploy/portainer/stack.yml`
- Create `.env` from `deploy/portainer/.env.example`
- Replace `<github-username>` and all `replace-*` placeholders
- Deploy/Redeploy stack

## Notes

- Do not commit real secrets into Git.
- Rotate keys immediately if they were pasted publicly.
