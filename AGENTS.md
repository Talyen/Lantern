# Lantern agent guide

## Project

Lantern is a desktop-browser fantasy action RPG prototype using Vite, TypeScript, three.js, and locally converted licensed art. The first milestone is a single playable encounter in the clearing.

## Owners and commands

Read [architecture](Docs/ARCHITECTURE.md) and [development workflow](Docs/DEVELOPMENT.md) for affected owners, commands and asset preparation. [Performance](Docs/PERFORMANCE.md) owns measurement evidence; [roadmap](ROADMAP.md) owns milestones.

Use `npm run check` for handoff (includes one production build and `git diff --check`). Use `npm run assets:check -- --playable` when verifying prepared art. Inspect status/diffs, preserve existing work, and re-read shared files during concurrent edits. Update the canonical owner when changing an invariant.

## Asset boundaries

- Treat Topaz as read-only. Do not copy animation libraries out of Topaz; animation acquisition is Mixamo-only.
- Keep licensed Synty and Mixamo source files under ignored `.local/`. Keep exported character, terrain, and Synty GLBs under ignored `public/vendor/`. Do not commit or distribute these files as standalone assets.
- Original text-prompted ImageGen surfaces may live under tracked `assets/textures/`. Do not send Synty models, textures, or renders to image generation tools. Project and bake locally.
- Check the applicable purchase terms and the contents of `dist/` before any public web deployment; Build staging selects explicit library IDs and copies other vendor directories wholesale; inspect `.local/build-inventory.json`.

## Prototype conventions

- Keep gameplay and render state explicit in TypeScript. The camera is fixed isometric with follow and scroll zoom; WASD or arrows move, Space attacks.
- Keep the encounter runnable when optional scenery is absent; report missing playable character art clearly.
- Select animation clips only from a verified compatible rig. The clearing uses the Synty Viking warrior with retained clips baked to that same rig. Use Mixamo exclusively for both the clearing and the comparison lab. Do not reintroduce the discarded animation providers. Preserve the full source catalog privately, and lazy-load only selected GLB clips.
- After gameplay edits, use a short real-browser smoke pass covering movement, hit timing, victory, defeat, retry, and rock inspection. Combine these checks into a few player flows.

## Player-facing UI

- Prefer conventional, compact game menus such as Options. Keep settings labels and values concise.
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
- Run the relevant fast checks once after the final change; repeat or broaden them only for new changes or unresolved failures. Run `npm run build` and `git diff --check` before handoff, and report any unverified core behavior.
- Revisit this policy when Lantern moves beyond the prototype phase or gains persistent player data or public release requirements.
