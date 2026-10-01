# Lantern agent guide

## Project

Lantern is a desktop-browser fantasy action RPG prototype using Vite, TypeScript, three.js, and locally converted licensed art. The first milestone is a single playable encounter in the clearing.

## Working style

- Inspect `git status --short` and relevant diffs before editing. Complete the requested behavior and its blockers; fix small, understood adjacent issues and report substantial independent findings. Avoid broad cleanup outside the task.
- Read affected owners and consumers first. Reuse existing libraries and boundaries; add dependencies or abstractions only for concrete consumers. Keep consequential decisions beside their canonical owner.
- Investigate failures with a specific hypothesis and focused evidence. Reassess unproductive approaches; do not change product behavior or raise timeouts merely to hide local contention.
- Use plain language and player-facing names. Include implementation details when they explain a decision or risk.

## Concurrent work and Git

- Prefer the existing checkout on `main`. Do not switch branches, create worktrees, commit, push or open a PR unless requested. If overlapping work cannot safely coexist, explain the conflict and propose sequencing or isolation.
- Follow the [shared-checkout procedure](Docs/DEVELOPMENT.md#working-alongside-other-agents): record task ownership locally, keep edits disjoint, and coordinate shared files and output-producing commands. Ownership notes are advisory, not locks.
- Re-read shared files and their current diffs immediately before editing; merge with the latest contents. Never overwrite another agent's changes from an earlier snapshot or treat unfamiliar edits as disposable.
- Never use destructive Git commands, broad restores, cleans or stashes to clear other work. Stage only reviewed, explicitly authorized paths; coordinate index and commit operations because the checkout shares one Git index.

## Owners and commands

Read [architecture](Docs/ARCHITECTURE.md) and [development workflow](Docs/DEVELOPMENT.md) for affected owners, commands and asset preparation. [Level design](Docs/LEVEL_DESIGN.md) owns area conventions and the rapid visual authoring loop. [Performance](Docs/PERFORMANCE.md) owns measurement evidence; [roadmap](ROADMAP.md) owns milestones.

Use `npm run check` for handoff (includes one production build and `git diff --check`). Use `npm run assets:check -- --playable` when verifying prepared art. Inspect status/diffs, preserve existing work, and re-read shared files during concurrent edits. Update the canonical owner when changing an invariant.

## Asset boundaries

- Keep licensed Synty and Mixamo source files under ignored `.local/`. Keep exported character, terrain, and Synty GLBs under ignored `public/vendor/`. Do not commit or distribute these files as standalone assets.
- Original text-prompted ImageGen surfaces may live under tracked `assets/textures/`. Do not send Synty models, textures, or renders to image generation tools. Project and bake locally.
- Check the applicable purchase terms and the contents of `dist/` before any public web deployment; Build staging selects explicit library IDs and copies other vendor directories wholesale; inspect `.local/build-inventory.json`.

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
- Select animation clips only from a verified compatible rig. Gameplay uses Paladin J Nordstrom for the player and Goblin D Shareyko for the enemy, with curated Mixamo clips baked independently to each rig. The default Paladin surface uses its original authored textures; projected ImageGen surfaces are optional experiments. Original text-prompted surfaces are projected and baked locally. Use Mixamo exclusively for both the clearing and the comparison lab. Do not reintroduce the discarded animation providers. Preserve the full source catalog privately, and lazy-load only selected GLB clips.
- After gameplay edits, use a short real-browser smoke pass covering movement, hit timing, victory, defeat, retry, and rock inspection. Combine these checks into a few player flows.

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

- Rapid iteration is the priority. Keep only a small number of fast, high-value tests that cover broad core behavior through representative player flows.
- Add an automated test only when it protects an important, established behavior and earns its ongoing runtime and maintenance cost. Prefer extending an existing test over adding another; do not add tests by default for every change or bug fix.
- Defer edge cases, exhaustive input combinations, speculative failure paths, and defensive test matrices while the design is evolving. Do not pursue coverage percentages or a test count.
- Test observable outcomes rather than implementation details. Avoid redundant assertions, snapshot churn, elaborate fixtures, and new test infrastructure for small changes. Remove or consolidate tests that duplicate coverage or constrain intentional design changes.
- Documentation, styling, asset experiments, and other reversible low-impact changes do not need new automated tests. Use focused inspection or a brief browser check as appropriate.
- Automated Electron checks must use `desktop:check` (or `--background`) and CDP. Do not launch visible or focusable Electron test windows while the user is working; visible runs are for explicitly requested manual review/play.
- Run the relevant fast checks once after the final change; repeat or broaden them only for new changes or unresolved failures. Use `npm run check` before handoff; it includes the production build and `git diff --check`, so do not repeat those separately on unchanged inputs. Report any unverified core behavior.
- Revisit this policy when Lantern moves beyond the prototype phase or gains persistent player data or public release requirements.

## Review and handoff

Review the final task-owned diff and surrounding integration, including changes made concurrently. Report the completed behavior, checks actually run, limitations and unresolved findings without log or diff dumps. Separate failures in task-owned changes from unrelated or concurrent failures; never claim the combined checkout is verified if it changed during the check.
