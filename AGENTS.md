# Lantern agent guide

## Project

Lantern is a desktop-browser fantasy action RPG prototype using Vite, TypeScript, three.js, and locally converted licensed art. The first milestone is a single playable encounter in the clearing.

## Working style

- Inspect `git status --short` and relevant diffs before editing. Complete the requested behavior and its blockers; fix small, understood adjacent issues and report substantial independent findings. Avoid broad cleanup outside the task.
- Read affected owners and consumers first. Reuse existing libraries and boundaries; add dependencies or abstractions only for concrete consumers. Keep consequential decisions beside their canonical owner.
- Investigate failures with a specific hypothesis and focused evidence. Reassess unproductive approaches; do not change product behavior or raise timeouts merely to hide local contention.
- Use plain language and player-facing names. Include implementation details when they explain a decision or risk.

## Concurrent work and Git

- Use `npm run agent:start -- --task <slug>` before feature edits, then use its returned worktree directory for every command. Up to four tasks may work independently. Do not edit main directly during ordinary task work.
- The [task workflow](Docs/DEVELOPMENT.md#working-alongside-other-agents) authorizes private task branches, reviewed local task commits, and automatic integration into local main. Pushes, PRs and releases still require a user request.
- One agent owns a task worktree through completion. Routine work requires no inter-agent messages, file reservations, or user-managed merges. Repair conflicts and failed sanity checks in the task, then retry `npm run agent:finish` until integrated.
- Stage only explicitly reviewed task paths. Never reset, clean, stash, overwrite or terminate another task's work. Preserve private source archives and unexpected main edits.
- Use managed previews and resource wrappers. Start rendering only for a relevant inspection, then close the owned session. The scripts automatically queue heavy operations and GPU reviews.

## Owners and commands

Read [architecture](Docs/ARCHITECTURE.md) and [development workflow](Docs/DEVELOPMENT.md) for affected owners, commands and asset preparation. [Level design](Docs/LEVEL_DESIGN.md) owns area conventions and the rapid visual authoring loop. [Performance](Docs/PERFORMANCE.md) owns measurement evidence; [roadmap](ROADMAP.md) owns milestones.

Use `npm run check` for a fast sanity check; `agent:finish` runs it on the integration candidate. Production checks use `npm run check:full` for CI or requested build/release readiness. Inspect the task diff and update the canonical owner when changing an invariant. Prepared-art tasks validate affected references; full playable validation is targeted, not a routine extra step.

## Asset boundaries

- Keep licensed Synty and Mixamo source files under ignored `.local/`. Keep exported character, terrain, and Synty GLBs under ignored `public/vendor/`. Do not commit or distribute these files as standalone assets.
- Original text-prompted ImageGen surfaces may live under tracked `assets/textures/`. Do not send Synty models, textures, or renders to image generation tools. Project and bake locally.
- Check the applicable purchase terms and the contents of `dist/` before any public web deployment; Build staging selects explicit library IDs and referenced gameplay art; inspect `.local/build-inventory.json`.

## Rendering invariant

- Lantern requires native WebGPU on every route, including the animation lab and level authoring. Do not add WebGL renderers, backend fallbacks, renderer switches, GLSL shader patches, or WebGL-only dependencies/features.
- Use `src/rendering/renderer.ts` for native-only initialization and `src/rendering/webgpu-pipeline.ts` for the single shared visual pipeline. Lab lanes may instantiate that same pipeline with independent temporal histories; do not build a separate lab render graph or render scenes directly.
- FSR Temporal is the only reconstruction method, with Balanced resolution quality and sharpening 0.50 as fresh/reset defaults. Output pixel ratio is always 1. There are no reconstruction fallbacks; unavailable WebGPU or FSR preparation must produce an actionable startup error. Shadows and particles use independent shared Low/Medium/High presets; atmosphere uses profile distance fog, with no volume buffer or ray marching.
- Build new materials/effects with TSL/node materials. `npm run check` enforces the runtime rendering policy. Revalidate the pinned three.js native-only initialization and temporal adapters on dependency upgrades; never weaken the guard to accommodate a second backend.

## Lighting authoring

- New areas use shared lighting profiles and small overrides through `src/levels/lighting.ts`; see [lighting authoring](Docs/LIGHTING.md). Do not duplicate scene lighting constants or apply outdoor moods globally.
- Local flame lights use the shared campfire/torch/lantern recipes. Gameplay campfire eligibility remains independent of cosmetic lighting.
- Prepare stable irradiance bakes explicitly with `npm run lighting:bake` in an owned native authoring session. Keep derived data private; routine checks/builds never regenerate it.
- Extend the small visual reference set when the first interior or enclosed dark area is introduced. Review character readability under the existing studio and outdoor references when shared lighting changes.

## Prototype conventions

- Keep gameplay and render state explicit in TypeScript. The camera is fixed isometric with follow and scroll zoom; WASD or arrows move, left click attacks, Shift dodges, B toggles Inventory, and Escape toggles Options or closes a menu.
- Keep the encounter runnable when optional scenery is absent; report missing playable character art clearly.
- Select animation clips only from a verified compatible rig. Gameplay uses Paladin J Nordstrom for the player and Goblin D Shareyko for the enemy, with curated Mixamo clips baked independently to each rig. The playable Paladin uses its original authored textures; retired palette experiments remain privately archived. Original text-prompted surfaces are projected and baked locally. Use Mixamo exclusively for both the clearing and the comparison lab. Do not reintroduce the discarded animation providers. Preserve the full source catalog privately, and lazy-load only selected GLB clips.
- After gameplay edits, use one short browser interaction flow demonstrating the changed behavior. Choose the relevant portion of the optional smoke references; do not replay the entire game checklist.

## Artistic responsibility

Follow [the art direction](Docs/ART_DIRECTION.md) for Lantern's visual identity and review criteria.

- Treat player-facing visual work as authored design. A functional first pass is a starting point; finish the composition, hierarchy, material treatment, and interaction details.
- Make a clear artistic choice within Lantern's established direction. Choose and iterate independently within the requested scope; ask when a choice would change the project's identity or gameplay.
- Before implementing, state the intended visual effect in one or two concrete sentences. Describe what the player will see and feel, and which visual decisions will create it. Keep this in working notes or commentary, never in the game.
- Establish a focal point and supporting hierarchy. Use deliberate silhouette, proportion, spacing, value contrast, lighting, and motion. Give important elements character; let supporting elements stay quiet.
- Prefer a few distinctive, coordinated decisions over many decorative additions. Default component styling, uniform prop distribution, and indiscriminate glow are unfinished when they undermine the intended composition.
- Inspect the actual result at gameplay scale. Identify the weakest visible part, revise it, and inspect again when needed. Passing checks or producing a screenshot does not establish visual quality.
- Communicate through the design before adding words. Do not compensate for weak visuals with slogans, descriptive headings, explanatory panels, or ornamental lore.

## Player-facing UI

- Use familiar menu names and predictable interactions, with compact layouts and a visual treatment specific to Lantern. Familiar behavior does not require default styling. Keep settings labels and values concise.
- Do not add slogans, narrative flavor text, prototype/lab branding, explanatory paragraphs, or instructional/status panels unless the user requests them or they are necessary for an actionable error.
- Keep the gameplay HUD limited to useful game state. Put settings and controls inside menus rather than around the scene.
- Keep implementation details out of player-facing text. Use short tooltips only when they help the player choose a setting.

## Testing during the prototype phase

- Aim for roughly 80% of effort on feature design, implementation and refinement. Sanity checks should take a small share of ordinary work; observed failures still need repair.
- Player-facing work normally needs one representative preview session, one relevant route and normal settings. Screenshots are optional. Improve an obvious visible weakness in the same session rather than collecting a review matrix.
- Documentation needs links and diff inspection, no browser. Internal tooling needs fast checks and one relevant observable outcome. Asset changes need inspection of the affected output and its required references.
- Do not add tests by default. Extend an existing test only for an important established behavior that warrants lasting protection. Avoid speculative edge cases, coverage targets, elaborate fixtures, implementation assertions and new gameplay test infrastructure.
- Run relevant checks once after the final edit. Repeat only after relevant changes or observed failures. Unrelated integration changes do not automatically invalidate visual acceptance.
- Broad gameplay flows, alternate moods/zooms/platforms, full catalogs, benchmarks and contact sheets are optional targeted tools. Expand verification only for a concrete failure, consequential save migration, renderer/dependency initialization change, or an explicit audit/release request; briefly state why.
- `npm run check` is the lean default. `npm run check:full` retains the full production gate. Neither automatically downloads, exports, bakes lighting, benchmarks, or runs browser matrices.
- Automated Electron uses hidden non-focusable `desktop:check` and CDP. Managed checks use two Vitest workers; resource leases allow two lightweight checks, one heavy operation and one agent GPU inspection. Leave the user's play session alone.
- Revisit this policy when Lantern moves beyond the prototype phase or gains public release requirements.

## Review and handoff

Review the task diff and its integration, finish through automatic local promotion, and report completed behavior, the sanity check performed, and material limitations briefly. Do not claim exhaustive coverage or cross-platform performance from a sanity check.
