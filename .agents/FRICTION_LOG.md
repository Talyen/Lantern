# Friction Log

Centralized intake for unresolved agent friction while working in Lantern. Keep entries short; one table row is usually enough. Use expanded details only when they help investigation.

## How to log and resolve

1. Consult this log when friction occurs. Record unresolved misleading guidance, workflow gaps, recurring problems, and significant first-time blockers. Skip routine transient failures and issues fully resolved during the same task; no task-start review is required.
2. Check for an existing matching entry before adding a row to **Open**. Update its evidence or context rather than duplicating it. Describe expected versus actual behavior, with enough information to investigate. Link relevant owners or evidence when useful; keep credentials, licensed assets, and private source material out of tracked entries.
3. Agents may proactively fix small, understood, reversible independent issues in their owned task when the cause and focused verification are clear. Leave broad, uncertain, or consequential changes open for a separate decision. Follow the [task workflow](../Docs/DEVELOPMENT.md#working-alongside-other-agents); preserve concurrent log entries during integration.
4. Resolve an open entry only after fixing and verifying its cause. A workaround alone leaves it open with updated context. Put lasting guidance in the canonical document or tool.
5. Move the resolved row and associated details to `friction-archive/YYYY.md`, using the year of resolution. Preserve the original entry date, replace the symptom with a concise fix and verification summary, and link to a commit or corrected owner. Adjust relative links for the archive location. Create the yearly archive only when needed, with a resolved-entries table and optional details, and add its link under **Archive** below.

## Open

| Date | Area | Symptom (expected vs actual) |
|------|------|------------------------------|
| 2026-10-02 | Click-to-gather approach | A Clearing click on `pine-3` stopped at approximately 1.133 m from its center, outside its 1.125 m interaction range, then abandoned the route without chopping. Clicking from 0.9 m completed all three contacts. [ClickApproach](../src/clearing/click-approach.ts) consumes the final waypoint within 0.18 m while [navigation](../src/gameplay/movement.ts) places the endpoint at 85% of interaction range; that tolerance can exceed the remaining reach margin. This path is unchanged by the runtime performance task; review final-waypoint arrival tolerance separately. |
| 2026-10-02 | Task dependency snapshots | Main and the freshly created `runtime-performance` worktree lacked `node_modules/eslint`, although the lockfile required it. [Task setup](../scripts/agents/workflow.mjs) stamped the cloned directory with the current manifest signature, so `ensureDependencies` skipped installation and the integration lint stage failed with `MODULE_NOT_FOUND`. A managed `npm ci` repairs this task only; validate the installed dependency snapshot before stamping future clones. |

## Archive

No resolved entries yet. Archives record history and are not required reading; search them when investigating recurring friction.

## Details

Add a `### YYYY-MM-DD — short slug` subsection here only when the table row needs more context. Keep the table as the index and identify the associated details there.

### Expanded entry template

```text
### YYYY-MM-DD — short slug

- **Context:** what you were trying to do
- **Expected:** what should have happened / where you expected to find guidance
- **Actual / confusion:** what happened or was unclear
- **Impact:** how it slowed or blocked the task
- **Evidence:** relevant owner, command result, or reproducible steps
- **Suggestion (optional):** what would help
```
