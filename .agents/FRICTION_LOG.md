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
| 2026-10-02 | Level preview reload | After scene-code/data HMR and reload, initial area preparation can remain pending before the authoring bridge appears. A cached AssetLibrary archway load remained pending even though a fresh GLTF load/parse of the same 281668-byte file completed. A later settled-frame check after data refresh also left CDP unresponsive. Restarting the owned browser/preview restored readiness; this is a workaround, and the stale-load cause remains unverified. Private evidence: graveyard-crypt preview log and level captures; also reproduced during Clearing surface preparation, with a fresh individual scenery load completing while the initial candidate remained pending. Clearing evidence is retained with the clearing-art-composition preview log. Texture-relief investigation also reproduced CDP/export stalls after area changes; completed atlas exports were retained and validated individually, while travel/reload reliability remains unresolved. The look-feel-polish pass also observed pending startup after owned browser reloads and one Crypt atlas-export timeout; reloading with the managed native-WebGPU browser flags and serial retry restored readiness/export. Native material proof and the four final atlas/signature checks passed, but the intermittent preparation cause remains unverified. Private captures and notes are retained with look-feel-polish. Sword/Bow mastery also reproduced an unresponsive managed browser after reload and interaction probes (agent-browser reported busy/unresponsive daemon reads); restarting only the owned preview restored native gameplay, rain rendering and shared-cooldown inspection. The underlying reload/daemon cause remains unverified; private evidence is retained with sword-bow-mastery. |

## Archive

[2026 resolutions](friction-archive/2026.md). Archives record history and are not required reading; search them when investigating recurring friction.

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
