# Release Note: 0.4.4

## Scope
Branding polish release for the Cortex Hub favicon, with post-release verification that live chat and embedding routing tests are healthy.

## Included Changes
- Added a dedicated Cortex Hub favicon/icon asset for the Next.js app
- Updated app metadata so browsers use the new icon instead of a missing default favicon
- Kept the icon aligned with the existing Cortex Hub branding:
  - dark background
  - violet gradient accent
  - diamond core matching the sidebar mark

## Verification
- Local:
  - `pnpm --filter @cortex/dashboard-web typecheck`
- Live runtime checks already passing on the current host:
  - `POST /api/llm/routing/test/chat`
  - `POST /api/llm/routing/test/embedding`

## Expected Result After Deploy
- Browser tabs should show the new Cortex Hub icon
- Bookmarks and pinned tabs should no longer fall back to a generic blank icon
- Existing provider live-test features should still work unchanged

## Deploy Checklist
1. Push `master`
2. Wait for GitHub Actions to build the new image
3. Pull the latest image on the Docker host
4. Hard-refresh the browser tab if the old favicon is cached
5. Confirm the new tab icon appears on `/`, `/providers`, and `/quality`
