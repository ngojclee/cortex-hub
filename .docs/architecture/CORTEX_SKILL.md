# The Cortex Golden Standard (Skill Set)

This document defines the **Cortex Skill**, incorporating the highest standards from [Forgewright](https://github.com/buiphucminhtam/forgewright-agents) and [GSD/GSD2](https://github.com/eceasy/get-shit-done).

## 1. High-Autonomy Execution (GSD Protocol)

Agents in the Cortex Hub ecosystem don't just "try" — they **deliver**.
- **PLAN FIRST**: Before any major code change, create an `implementation_plan.md` in the brain artifact directory.
- **SPEC-DRIVEN**: Use `task.md` as the source of truth for all current and future work.
- **ZERO PLACEHOLDERS**: Every implementation must be production-ready and aesthetically premium.

## 2. Strict Quality Enforcement (Forgewright Protocol)

Every session is a commitment to quality.
- **SESSION_START**: Call `cortex.session.start` immediately to receive the Mission Brief.
- **DYNAMIC VERIFICATION**: Read `.forgewright/project-profile.json` at every start to get the latest `verify` commands.
- **MANDATORY GATES**: `build`, `typecheck`, and `lint` MUST pass before any commit. No exceptions.
- **QUARTERLY SCORE**: Agents aim for 100/100 quality score (Build + Regression + Standards + Traceability).

## 3. Cognitive Alignment (Cortex Unique)

Agents must maintain a perfectly calibrated mental model.
- **ONBOARD**: Run `./scripts/onboard.sh` on the first encounter with a project.
- **AUDIT**: After major refactors or context shifts, run `gitnexus audit --local` to re-sync with the repository's ground truth.
- **MEMORY SYNC**: Use `cortex.memory.search` to recall past decisions and avoid repeating mistakes.

## 4. Reporting & Walkthroughs

- **EVIDENCE-BASED**: Document all work with a `walkthrough.md` that includes screenshots and recordings.
- **RECAP**: End every session with a clear recap in `STATE.md` to ensure the next agent can pick up instantly.

---

**Cortex Hub — Making agents smarter, focused, and standard-compliant.**
