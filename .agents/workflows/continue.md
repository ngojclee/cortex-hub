---
description: Resume work from STATE.md context, auto-triggered by "continue", "tiếp", "go", or when no specific command given
---
# /continue — Resume Current Work

// turbo-all

## Trigger Patterns
- User says: "continue", "tiếp", "go", "tiếp tục", "resume"
- User pastes a follow-up without specific command

## Steps

### 1. Start Session (MANDATORY)
Call the `cortex_session_start` MCP tool with the current repo URL and mode:
```
cortex_session_start({ repo: "<current repo URL>", mode: "development" })
```
This creates a session record and returns project context. If it fails or hangs, note the error and continue.

### 2. Recall Context
- **`cortex_memory_search`** → search for memories about the current task
- Read `STATE.md` at project root. Identify:
  - Current active phase
  - First `[/]` (in-progress) task, or first `[ ]` uncompleted task
  - Recent decisions that affect current work

### 3. Load Project Profile
Read `.cortex/project-profile.json` → note `verify.pre_commit` commands.

### 4. Resume Task
Continue the identified task. Follow the appropriate workflow:
- If task is code implementation → follow `/code` workflow
- If task is infrastructure → follow direct execution
- If task is documentation → write directly

**During work, use Cortex tools:**
- **`cortex_code_search`** before `grep_search` for finding code
- **`cortex_code_impact`** before editing core files
- **`cortex_memory_store`** when learning something new

### 5. Post-Work Verification
Run ALL commands from `project-profile.json` → `verify.pre_commit`:
// turbo
```bash
pnpm build
```
// turbo
```bash
pnpm typecheck
```
// turbo
```bash
pnpm lint
```

### 6. Update STATE.md
- Mark completed tasks `[x]`
- Add new decisions if any
- Update blockers

### 7. Report & Learn
- **`cortex_quality_report`** → report build/typecheck/lint results
- **`cortex_memory_store`** → store any new knowledge from this session

```
## Session Summary
- Task: [what was done]
- Build: ✅/❌ | Typecheck: ✅/❌ | Lint: ✅/❌
- STATE.md updated: ✅
- Cortex tools used: code_search ✅/❌ | memory ✅/❌ | quality_report ✅/❌
```
