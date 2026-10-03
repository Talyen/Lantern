# Lantern agent guide

## Project

Lantern is a desktop-browser fantasy action RPG prototype using Vite, TypeScript, three.js, and locally converted licensed art. The current prototype connects Homestead and Forest Clearing, with a guarded camp, a separate caster fight, two weapon sets, assignable abilities, loot, Woodcutting, Mining, shelter restoration and a stash. [The roadmap](ROADMAP.md) owns the remaining milestones.

## Load only relevant context

Start with [the daily workflow](Docs/DEVELOPMENT.md) and [task routing](Docs/ARCHITECTURE.md#task-routing), or run `npm run agent:context -- --topic <topic>`. Follow the linked instructions for affected work and read owners/consumers before editing. Detailed runtime contracts, asset recipes and interaction flows are separate references; historical evidence is optional. Use `agent:inspect` for bounded area/motion/audio records rather than reading whole manifests. Use `agent:context -- --topic <topic> --include-docs --consumers` for bounded sections and direct import consumers, `agent:source` for symbols/line spans, and `agent:diagnostics` for saved check failures. [Read-only tool help](Docs/DEVELOPMENT_REFERENCE.md#read-only-agent-tools) owns budgets and continuation.

## Working style

- Inspect `git status --short` and relevant diffs before editing. Complete the requested behavior and its blockers; fix small, understood adjacent issues and report substantial independent findings. Avoid broad cleanup outside the task.
- Read affected owners and consumers first. Reuse existing libraries and boundaries; add dependencies or abstractions only for concrete consumers. Keep consequential decisions beside their canonical owner.
- Investigate failures with a specific hypothesis and focused evidence. Reassess unproductive approaches; do not change product behavior or raise timeouts merely to hide local contention.
- Use plain language and player-facing names. Include implementation details when they explain a decision or risk.

## Concurrent work and Git

- Run `npm run agent:start -- --task <slug>` before any task edits, including documentation; use its returned worktree for every command. Do not edit main. The [task workflow](Docs/DEVELOPMENT_REFERENCE.md#private-assets-and-resource-use) owns shared capacity and queued admission.
- One agent owns a task through completion. Private task branches, reviewed local commits and automatic local integration are authorized. Pushes, PRs and releases require a user request. Routine work needs no inter-agent messages, file reservations or user-managed merges.
- Stage only reviewed task paths. Never reset, clean, stash, overwrite or terminate another task's work. Preserve unexpected main edits and private source archives.
- Repair conflicts/check failures in the task and retry `npm run agent:finish` until integrated; then clean the completed worktree. Use managed previews/resource wrappers and close owned sessions after inspection.

## Asset boundaries

- Keep licensed Synty and Mixamo source files under ignored `.local/`. Keep exported character, terrain, and Synty GLBs under ignored `public/vendor/`. Do not commit or distribute these files as standalone assets.
- Original text-prompted ImageGen surfaces may live under tracked `assets/textures/`. Do not send Synty models, textures, or renders to image generation tools. Project and bake locally.
- Check the applicable purchase terms and the contents of `dist/` before any public web deployment; Build staging selects explicit library IDs and referenced gameplay art; inspect `.local/build-inventory.json`.

## Rendering invariant

- Lantern requires native WebGPU on every route, including the animation lab and level authoring. Do not add WebGL renderers, backend fallbacks, renderer switches, GLSL shader patches, or WebGL-only dependencies/features.
- Use `src/rendering/renderer.ts` for native-only initialization and `src/rendering/webgpu-pipeline.ts` for the single shared visual pipeline. Lab lanes may instantiate that same pipeline with independent temporal histories; do not build a separate lab render graph or render scenes directly.
- FSR Temporal is the only reconstruction method, with Balanced resolution quality and sharpening 0.50 as fresh/reset defaults. Output pixel ratio is always 1. There are no reconstruction fallbacks; unavailable WebGPU or FSR preparation must produce an actionable startup error. Shadows and particles use independent shared Low/Medium/High presets; atmosphere uses preset distance fog, with no volume buffer or ray marching.
- Build new materials/effects with TSL/node materials. `npm run check` enforces the runtime rendering policy. Revalidate the pinned three.js native-only initialization and temporal adapters on dependency upgrades; never weaken the guard to accommodate a second backend.

## Topic invariants and visual work

- Every meaningful UI or gameplay action must produce timely, perceptible, truthful feedback, including blocked, pending and cancelled interactions. Essential outcomes must remain understandable without sound. Follow the [interaction feedback principle](Docs/INTERACTION_FEEDBACK.md); existing clear state changes can satisfy it.
- All routes use shared Golden lighting and local flame recipes through `src/levels/lighting.ts`. Read [lighting authoring](Docs/LIGHTING.md#agent-lighting-workflow) before lighting changes; bakes remain explicit and private.
- Gameplay and presentation stay explicit in TypeScript. Follow [prototype conventions](Docs/RUNTIME.md#prototype-conventions) for controls, tool-free gathering, optional scenery and rig-compatible Mixamo clips. Preserve authored playable textures and private source catalogs.
- Before any player-facing visual change, read [art direction and visual workflow](Docs/ART_DIRECTION.md#agent-visual-workflow). State the intended visible effect in working notes/commentary, finish the composition and interaction details, then inspect and refine at gameplay scale. Keep implementation details and unrequested flavor/status copy out of the game.

## Validation and handoff

Use `npm run check`; `agent:finish` runs the change-aware sanity gate on its integration candidate. Full suites/builds/HTTP smoke remain CI-first; requested local full validation uses `npm run check:full -- --allow-local`. Do not repeatedly run unchanged checks. Prepared-art work validates affected output/references.

Default to no new automated tests. Add or materially expand a test only when it protects a consequential behavior against a concrete, plausible failure and provides lasting confidence beyond existing checks. Low- and medium-value tests are normally out of scope unless explicitly requested. A bug fix does not automatically require a regression test. Follow the [test admission and review policy](Docs/DEVELOPMENT_REFERENCE.md#testing-during-the-prototype-phase) for unit and UI/E2E tests, including a short rationale when adding or materially expanding tests.

After gameplay edits, exercise one short relevant interaction in one owned normal-settings preview; [smoke references](Docs/SMOKE_REFERENCES.md) are a menu, not a checklist. Documentation needs links/diff review; tooling needs one observable outcome. Broaden inspection only for a concrete failure, consequential save migration or renderer/dependency initialization change. Leave the user's play session alone; automated Electron uses hidden non-focusable `desktop:check` and CDP.

Performance testing requires a specific user request or evidenced defect, recorded with `levels:measure --reason "request or defect evidence"`; it borrows the owned preview's GPU lease. Routine work, audits, release readiness and automation do not authorize benchmarks or full local suites. Do not schedule tests or measurements by default. [Performance](Docs/PERFORMANCE.md) owns measurement evidence.

Review the task diff and local integration; briefly report completed behavior, sanity check and material limits. Checks/builds do not establish visual quality or cross-platform performance. Update the canonical owner when changing an invariant.

## Friction

When friction occurs, consult [.agents/FRICTION_LOG.md](.agents/FRICTION_LOG.md) and follow its intake/resolution rules. Fix small, understood, reversible issues in scope; log broad or uncertain problems. Verify the cause before archiving a resolution. Preserve concurrent entries. No task-start review or routine transient-failure entry is required.
