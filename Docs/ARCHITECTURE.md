# Architecture

Lantern keeps simulation and presentation explicit. This is a small prototype, not a general game engine.

[ESLint](../eslint.config.js) enforces the direct import boundaries for static imports/re-exports, import types and dynamic imports with statically known string paths: gameplay cannot import three.js, rendering or UI, and rendering cannot import UI. These forms use the same named policy, including constant aliases and string concatenation; runtime-computed paths and transitive dependencies remain outside this direct-import check. Gameplay may consume level data and its physics/navigation libraries; presentation may consume gameplay types and definitions. [Storage ownership](../eslint/rules.mjs) reserves browser storage globals for the application boot seam, graphics settings and the shared [optional preference storage](../src/data/preferences.ts) boundary, including simple constant aliases of browser globals and constant storage keys. Gameplay persistence continues receiving injected storage rather than reaching for browser globals. New storage access must use those owners or deliberately update the named policy and its fixtures. The separate [rendering-policy check](../scripts/check-rendering.mjs) remains authoritative for native WebGPU and the shared pipeline. It parses executable syntax and follows local import, constructor and renderer aliases; comments and ordinary error text do not create policy violations.

## Task routing

This table is the canonical map read by `agent:context`. Owners are starting points: inspect their consumers too. Read the linked sections, rather than every guide. All tasks use the [daily workflow](DEVELOPMENT.md) and lean `npm run check`; the Inspect column provides optional read-only discovery, while Acceptance identifies the relevant review.

| Topic | Task | Owners | Read | Inspect | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `inventory` | Inventory, loot, Shop, travel and saves | [inventory](../src/gameplay/inventory.ts), [adventure](../src/gameplay/adventure.ts), [coordinator](../src/clearing/inventory.ts) | [collection](LOOT.md#drops-and-collection), [ownership](LOOT.md#ownership-and-integration), [saves](RUNTIME.md#save-recovery), [travel](RUNTIME.md#travel-and-fire-safety), [commits](RUNTIME.md#inventory-commits) | — | One changed Inventory or travel interaction |
| `equipment` | Shared equipment, catalog values and combat stats | [equipment](../src/gameplay/equipment.ts), [stats](../src/gameplay/combat-stats.ts), [coordinator](../src/clearing/inventory.ts) | [Equipment](EQUIPMENT.md), [runtime](RUNTIME.md#equipment-and-trees) | — | One changed equipment interaction; retain resource-cap rules |
| `progression` | Shared XP, level curves, tree milestones and reward tuning | [skills](../src/gameplay/skills.ts), [nodes](../src/gameplay/skill-nodes.ts), [Adventure](../src/gameplay/adventure.ts) | [Progression](PROGRESSION.md), [Equipment](EQUIPMENT.md), [Smithing](SMITHING.md) | — | One changed XP or earned-action interaction |
| `combat` | Abilities, enemy behavior and projectiles | [encounter](../src/gameplay/encounter.ts), [abilities](../src/gameplay/abilities.ts), [combat](../src/clearing/combat.ts) | [caster](RUNTIME.md#solo-caster-encounter), [buffering](RUNTIME.md#input-buffering), [combat values](EQUIPMENT.md#combat-values), [flows](SMOKE_REFERENCES.md#optional-targeted-smoke-references) | — | One changed combat interaction |
| `input` | Controls, camera, action bar and Skills | [bindings](../src/input/bindings.ts), [input](../src/clearing/input.ts), [combat UI](../src/ui/combat.ts) | [input ownership](RUNTIME.md#action-bar-and-input-ownership), [buffering](RUNTIME.md#input-buffering), [aim](RUNTIME.md#pointer-aim), [controls](SMOKE_REFERENCES.md#combat-controls-and-focused-acceptance) | — | One changed control/menu interaction |
| `gathering` | Woodcutting, Mining, shelter and stash | [harvesting](../src/gameplay/harvesting.ts), [gathering](../src/clearing/gathering.ts), [resources](../src/levels/resources.ts) | [Gathering](GATHERING.md), [conventions](RUNTIME.md#prototype-conventions) | — | One changed gathering or home interaction |
| `smithing` | Homestead Forge/Reclaim, recipes and Smithing talents | [smithing](../src/gameplay/smithing.ts), [Adventure](../src/gameplay/adventure.ts), [sheet](../src/ui/smithing-panel.ts) | [Smithing](SMITHING.md), [commits](RUNTIME.md#inventory-commits), [UI workflow](ui/WORKFLOW.md) | — | One Forge/Reclaim interaction at the workshop |
| `rendering` | Renderer, FSR, materials and effects | [renderer](../src/rendering/renderer.ts), [pipeline](../src/rendering/webgpu-pipeline.ts), [graphics](../src/rendering/graphics.ts) | [contract](RUNTIME.md#rendering-contract), [preparation](RUNTIME.md#graphics-preparation), [Graphics](GRAPHICS.md), [art](ART_DIRECTION.md#agent-visual-workflow) | — | One affected route; startup/error probes for initialization changes |
| `lighting` | Golden preset, local lights and bakes | [lighting](../src/levels/lighting.ts), [area lighting](../src/rendering/area-lighting.ts) | [Lighting](LIGHTING.md), [art](ART_DIRECTION.md#agent-visual-workflow) | `npm run agent:inspect -- --area clearing --section lighting` | Gameplay-scale character readability; interior reference when introduced |
| `levels` | Area layout, scenery and navigation | [registry](../src/levels/registry.ts), [builder](../src/levels/builder.ts), [area types](../src/levels/types.ts) | [replacement](RUNTIME.md#area-replacement), [navigation](RUNTIME.md#navigation-ownership), [Level Design](LEVEL_DESIGN.md), [art](ART_DIRECTION.md#agent-visual-workflow) | `npm run agent:inspect -- --area clearing --section props --limit 5` | One affected area and changed interaction |
| `animation` | Compatible clips, equipment and gathering motions | [motions](../assets/motion-profiles.json), [animations](../src/animation/combat-animations.ts), [actors](../src/clearing/actors.ts) | [Animations](ANIMATIONS.md), [playable preparation](ASSET_PREPARATION.md#required-playable-character-and-motions), [conventions](RUNTIME.md#prototype-conventions) | `npm run agent:inspect -- --source motion --section clips --limit 5` | One changed motion; lab only for relevant comparison |
| `audio` | Gameplay cues, mixing and sound preferences | [manifest](../assets/audio/manifest.json), [gameplay audio](../src/audio/gameplay.ts), [playback](../src/audio/audio.ts) | [Audio](AUDIO.md) | `npm run agent:inspect -- --source audio --section cues --limit 5` | One changed cue or preference interaction |
| `ui` | Design system, HUD, Title/Play and menu presentation | [design system](UI_DESIGN.md), [HUD](../src/ui/hud.ts), [Inventory UI](../src/ui/inventory-panel.ts), [Options](../src/ui/options.ts) | [UI workflow](ui/WORKFLOW.md), [screen coverage](ui/SCREEN_CATALOG.md), [art](ART_DIRECTION.md#agent-visual-workflow), [HUD](RUNTIME.md#hud-and-player-controls), [Graphics](GRAPHICS.md) | — | One affected menu or HUD at gameplay scale; concepts/docs use links and diff review |
| `assets` | Private imports, surfaces, review and staging | [review resolver](../scripts/assets/review/index.mjs), [staging](../scripts/assets/stage-library-build.mjs), [asset checks](../scripts/check-assets.mjs) | [review](ASSET_REVIEW.md), [preparation](ASSET_PREPARATION.md), [ownership](RUNTIME.md#asset-and-resource-ownership), [art](ART_DIRECTION.md#agent-visual-workflow) | — | Affected prepared output and required references |
| `tooling` | Agent workflow, checks and scripts | [agent CLI](../scripts/agents/cli.mjs), [checks](../scripts/check.mjs), [CLI helpers](../scripts/lib/cli.mjs) | [resources](DEVELOPMENT_REFERENCE.md#private-assets-and-resource-use), [script conventions](DEVELOPMENT_REFERENCE.md#script-conventions), [checks](DEVELOPMENT_REFERENCE.md#commands-and-handoff), [reads](DEVELOPMENT_REFERENCE.md#read-only-agent-tools) | `npm run agent:status` | One relevant observable command outcome |
| `docs` | Repository guidance and roadmap | [guide](../AGENTS.md), [workflow](DEVELOPMENT.md), [roadmap](../ROADMAP.md) | [workflow](DEVELOPMENT.md), [change method](RUNTIME.md#change-method) | — | Link check and task diff review |

Session flow and slot ownership begin at [application](../src/application.ts), [adventure store](../src/gameplay/adventure-store.ts) and [save recovery](RUNTIME.md#save-recovery); inspect these alongside the UI/gameplay owners for front-end changes.

## Desktop reporting

[Desktop candidates and reporting](DESKTOP.md) owns distribution and report behavior. The bounded collector in `src/diagnostics/report.ts` starts before route imports and receives selected status from [clearing diagnostics](../src/clearing/diagnostics.ts), which keeps report fields separate from the full development snapshot. It never consumes the full gameplay diagnostic snapshot or character saves. Electron's `electron/reporting.cjs` owns local report retention and native export through the restricted preload bridge.

## Owners and data flow

See [the detailed owners and data flow reference](RUNTIME.md#owners-and-data-flow).

## Rendering contract

See [the detailed rendering contract reference](RUNTIME.md#rendering-contract).

## Asset and resource ownership

See [the detailed asset and resource ownership reference](RUNTIME.md#asset-and-resource-ownership).

## Change method

See [the detailed change method reference](RUNTIME.md#change-method).

## HUD and player controls

See [the detailed hud and player controls reference](RUNTIME.md#hud-and-player-controls).

## Solo caster encounter

See [the detailed solo caster encounter reference](RUNTIME.md#solo-caster-encounter).

## Equipment and trees

See [the detailed equipment and trees reference](RUNTIME.md#equipment-and-trees).

## Area lighting

See [the detailed area lighting reference](RUNTIME.md#area-lighting).

## Action bar and input ownership

See [the detailed action bar and input ownership reference](RUNTIME.md#action-bar-and-input-ownership).

Enemy packs use [the authored enemy registry](RUNTIME.md#authored-enemy-packs-and-area-preparation), with area-owned instances prepared by `src/clearing/enemy-actors.ts` before travel commit. [Graveyard areas](LEVEL_DESIGN.md#graveyard-ruins-and-graveyard-crypt) use the same simulation, presentation and WebGPU pipeline.
