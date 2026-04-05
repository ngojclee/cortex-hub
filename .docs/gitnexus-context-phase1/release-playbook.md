# Release Playbook

## Goal
Hand this file to another AI or operator when they need to finish a release, pull Docker images, and verify Cortex Hub without guessing the next steps.

## 1. Confirm Git and GitHub Actions
From the project repo:

```powershell
cd d:\Python\projects\cortex-hub
git fetch origin
git log --oneline --decorate -5
git status --short --branch
```

Expected:
- local branch is on `master`
- the intended feature commit is already pushed
- GitHub Actions has built the new images

## 2. Pull the New Docker Images
On the Docker host:

```bash
cd ~/cortex-hub
docker compose pull
docker compose up -d
```

If Watchtower is used, still verify the image tag after pull.

## 3. Verify the Live Release
Check health first:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/health
```

Minimum success criteria:
- `status = ok`
- `version` changed to the new release
- `commit` matches the expected deployed commit
- `qdrant`, `cliproxy`, `gitnexus`, `mem9`, `mcp` all report `ok`

## 4. Verify GitNexus vs Cortex Project Linking
These two checks answer two different questions:

### 4.1 Is GitNexus indexed?
```powershell
Invoke-RestMethod http://10.21.1.108:4000/api/intel/repos
```

If this returns repos with symbols/processes, GitNexus is working.

### 4.2 Does Cortex know any projects?
```powershell
Invoke-RestMethod http://10.21.1.108:4000/api/projects
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/projects
```

If these are empty while `/api/intel/repos` has data, the release is healthy but project linking is still missing.

## 5. Create a Cortex Project When Resources Are Empty
First check orgs:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/api/orgs
```

Default org on clean setups:
- `org-default`

Create a project:

```powershell
$body = @{
  name = 'cortex-hub'
  description = 'Cortex Hub'
  gitRepoUrl = 'https://github.com/ngojclee/cortex-hub.git'
  gitProvider = 'github'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://10.21.1.108:4000/api/orgs/org-default/projects' `
  -ContentType 'application/json' `
  -Body $body
```

## 6. Start or Re-Run Indexing
Replace `<projectId>` with the created project id:

```powershell
$body = @{
  branch = 'master'
  triggeredBy = 'manual'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://10.21.1.108:4000/api/projects/<projectId>/index" `
  -ContentType 'application/json' `
  -Body $body
```

Check status:

```powershell
Invoke-RestMethod "http://10.21.1.108:4000/api/projects/<projectId>/index/status"
```

## 7. Verify Resource Layer
After the project is linked and indexed:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/projects
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/project/<projectId>/context
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/project/<projectId>/clusters
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/project/<projectId>/processes
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/project/<projectId>/schema
```

## 8. Verify Shared Metadata Flow
Start a session:

```powershell
$body = @{
  repo = 'https://github.com/ngojclee/cortex-hub.git'
  mode = 'development'
  agentId = 'release-check'
} | ConvertTo-Json

$session = Invoke-RestMethod `
  -Method Post `
  -Uri 'http://10.21.1.108:4000/api/sessions/start' `
  -ContentType 'application/json' `
  -Body $body

$session
```

Then list sessions:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/api/sessions/all
```

Success means:
- session exists
- `sharedMetadata` is present when the project is linked
- session response includes project context and suggested next resources

## 9. When to Stop and Hand Back to Codex
After these are true:
- new Docker image is live
- project linking works
- resource endpoints return data
- shared metadata appears in session payloads

At that point, tell Codex:
- release is confirmed live
- health version and commit
- whether `/api/intel/resources/projects` is still empty or now populated
- the project id that was created

Then Codex can continue with the next feature safely.
