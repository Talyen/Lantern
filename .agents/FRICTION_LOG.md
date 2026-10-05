# Friction Log

Centralized intake for unresolved agent friction while working in Lantern. Keep entries short; one table row is usually enough. Use expanded details only when they help investigation.

## How to log and resolve

1. Consult this log when friction occurs. Record unresolved misleading guidance, workflow gaps, recurring problems, and significant first-time blockers. Skip routine transient failures and issues fully resolved during the same task; no task-start review is required.
2. Check for an existing matching entry before adding a row to **Open**. Update its evidence or context rather than duplicating it. Describe expected versus actual behavior, with enough information to investigate. Link relevant owners or evidence when useful; keep credentials, licensed assets, and private source material out of tracked entries.
3. Agents may proactively fix small, understood, reversible independent issues in their owned task when the cause and focused verification are clear. Leave broad, uncertain, or consequential changes open for a separate decision. Follow the [task workflow](../Docs/DEVELOPMENT.md#working-alongside-other-agents); preserve concurrent log entries during integration.
4. Resolve an open entry only after fixing and verifying its cause. A workaround alone leaves it open with updated context. Put lasting guidance in the canonical document or tool.
5. Move the resolved row and associated details to `friction-archive/YYYY.md`, using the year of resolution. Preserve the original entry date, replace the symptom with a concise fix and verification summary, and link to a commit or corrected owner. Adjust relative links for the archive location. Create the yearly archive only when needed, with a resolved-entries table and optional details, and add its link under **Archive** below.

## Open

| Date | Issue | Evidence and next action |
| --- | --- | --- |
| 2026-10-05 | One owned Clearing preview became unresponsive after author placement and a keyboard return cast. | The page was initially ready with default graphics. After Play, `placePlayer(-2.8, 2.8, 0)` and T, both Runtime.evaluate and Debugger.enable stopped responding; an OS stack sample showed the renderer main thread executing unsymbolized code. A fresh managed session without manual placement cast and entered the home portal successfully. Cause remains unverified; reproduce placement/input independently before changing navigation or rendering. The `area-transition-owner` task retains the stack sample with its captures. |
| 2026-10-05 | Safari reloads during world entry after exceeding its memory limit. | The local Safari log reports a 14,069 MB footprint, 12,136 MB after attempted relief, and `ExceededMemoryLimit`. An owned normal-settings Chromium Homestead entry at revision `a818adf8e3de` created about 4.1 GiB of GPU textures, including repeated named 4K atlases, and 260 overlapping native pipeline requests. Shader-node construction accounted for about 97% of the sampled retained allocation bytes during a repeat entry. See details below; unresolved evidence is retained with the `safari-memory-investigation` task. |

## Archive

[2026 resolutions](friction-archive/2026.md). Archives record history and are not required reading; search them when investigating recurring friction.

## Details

Add a `### YYYY-MM-DD — short slug` subsection here only when the table row needs more context. Keep the table as the index and identify the associated details there.

### 2026-10-05 — Safari world-entry memory

- **Confirmed failure:** Safari 27 on this 16 GiB host killed the local world-entry web process at 11:59:22 PDT. Its dump included 17,704,168 JavaScript objects, a 4,501 MB JavaScript heap and 3,501 MB of extra heap memory. This establishes memory exhaustion, but does not identify the retaining objects in Safari.
- **Owned comparison:** Chromium at 1920 × 1080 CSS pixels, DPR 1, fresh default graphics, reached Homestead with prepared lighting and no reported runtime failures. The first entry created 633 shader modules, 310 native pipelines, about 4.1 GiB of GPU textures and 34 MiB of GPU buffers. These are creation totals, not live-memory peaks; mip/format estimates omit driver overhead. Of 89 uncompressed 2K/4K RGBA texture allocations, matching nonempty labels, sizes and formats suggest about 0.9 GiB of repeated atlas storage; prove resolved source and sampling equivalence before sharing. A repeat entry's V8 sampling profile attributed 565.7 MB of 581.0 MB sampled retained allocations to shader-node build paths. Instrumentation and this different browser are not Safari memory or performance acceptance.
- **Priorities:** First share equivalent runtime textures across GLTFs, with explicit leases and bitmap disposal, through [asset loading](../src/assets/asset-library.ts) and [rig art](../src/assets/rig-art.ts). Then prepare high-quality GPU-compressed maps and route all relevant GLTF loaders through the existing [KTX2 scenery support](../src/assets/scenery-loader.ts), checking normal/roughness/alpha fidelity. Reduce duplicate shader graphs and bound first-use native compilation in the [shared renderer](../src/rendering/renderer.ts) and [pipeline](../src/rendering/webgpu-pipeline.ts); keep destination readiness truthful. Bound inactive library/rig retention and asset decode concurrency as follow-up work, rather than assuming the existing unused-scene budget covers those owners.
- **Acceptance:** Compare a fresh Safari entry and reload/Continue at the same recorded settings and drawable resolution, record process footprint by preparation stage and compilation concurrency, and verify travel/Return to Title releases resources. Preserve native WebGPU, FSR, physical output, authored detail and saved settings. Do not claim closure from Chromium completion or lower creation totals alone.

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
