# Development workflow

Use Node 24 from `.node-version`, npm 11+, and `npm ci`. Direct reads and scoped `rg` are enough for discovery. Inspect status and relevant diffs before editing; preserve unrelated changes and re-read shared files during concurrent work.

## Working alongside other agents

The default is 2–3 agents working in the existing `main` checkout with disjoint ownership. This keeps integration immediate, but all agents share files, the Git index, dependencies and generated outputs. A passing check describes the contents it actually read, not later edits.

1. Before editing, inspect status, relevant diffs and any active notes under ignored `.local/agent-work/`. Create your own uniquely named task note there with a chat/task identifier, timestamp, owned paths, planned shared-file edits, and any shared resources you need. Update only your note and remove it when finished. Verify stale notes before treating them as active; these notes are coordination aids, not atomic locks.
2. Keep ownership disjoint where practical. For an overlapping file, agree on sequencing with the active agent through available coordination tools, or ask the user if coordination is unavailable and the overlap blocks progress. Work on independent paths meanwhile. Reading a file again helps preserve current edits but cannot prevent simultaneous writes; do not rewrite a whole shared file from a saved snapshot.
3. Coordinate edits to shared contracts, `package.json`, the lockfile and canonical docs. Dependency installation, asset exports, builds and final gates must not overlap with other operations using the same dependencies or output paths (`dist/`, `public/vendor/`, and shared `.local/` manifests). Reserve the operation in your note and confirm conflicting work has yielded before starting; a note alone is not mutual exclusion. Agree on a brief edit pause for the final gate, or report that concurrent edits prevented verification of a stable combined checkout.
4. Use separate ports and profiles for browser/CDP sessions when supported. Own and close only your processes. Coordinate GPU-heavy inspection and close owned rendering sessions before the final gate, following the contention guidance below.
5. Commit and push only when requested. Serialize staging/commit operations; inspect the staged diff before committing and exclude other tasks unless the user requested the combined work. Avoid `git add .` or `git add -A` in a shared dirty checkout. If a file contains several tasks, coordinate a combined commit or stage reviewed hunks. Never reset, restore, clean, stash or terminate another agent's work to make your task easier.

Large cross-cutting refactors or incompatible experiments may need sequencing or an isolated checkout. Explain the concrete collision before proposing that exception; do not silently move the shared checkout to another branch.

## Level authoring

Use the persistent preview and captures in [level design](LEVEL_DESIGN.md): `npm run levels:dev`, `npm run levels:capture`, `npm run levels:check`, `npm run levels:assets`, `npm run levels:measure`, and `npm run levels:stop`. Close owned sessions before the final gate. Ordinary scene-data edits need no build/export/restart.

## Commands and handoff

| Command | Role |
| --- | --- |
| `npm run dev` | Browser iteration on loopback |
| `npm run typecheck` | Runtime, tests and Vite/Vitest configuration types |
| `npm test` | Small Node simulation suite |
| `npm run docs:check` | Maintained local Markdown links, heading fragments and npm command names, including archives |
| `npm run levels:check` | Area definitions, gate links, library selections and optional-art warnings |
| `npm run build` | Typecheck, stage private runtime art, and build |
| `npm run preview` | Serve the built renderer locally |
| `npm run smoke:preview` | Owned preview server and HTML/JS/CSS response checks |
| `npm run assets:check` | Available local runtime assets and selected-library closure |
| `npm run assets:check -- --playable` | Require character and compatible default Mixamo motions |
| `npm run check` | Rendering policy, docs, types, tests, level validation, one build, asset/build inventory, preview, diff whitespace |
| `npm run desktop` | Build and open a visible window for requested manual play |
| `npm run desktop:run` | Visible manual play of an existing build |
| `npm run desktop:check -- --debug-port=9231` | Hidden non-focusable Electron; attach CDP |

Run focused checks during work, then `check` once after the final edit. It retains stage logs and passed/failed/skipped outcomes under ignored `.local/checks/`; failures skip later stages and exit nonzero. The gate typechecks once and calls the build's internal skip-typecheck option. Standalone build still typechecks. Exporters never run from checks.

Asset-free CI runs this same gate from tracked sources. Build/resource success does not prove playable art, gameplay correctness or GPU performance. Report those separately. Tests protect important established outcomes; do not pursue counts, percentages, per-mechanic browser coverage, or redundant assertions. Styling and documentation do not need new tests.

## Private asset workflow

See [character preview](CHARACTERS.md) for the complete model gallery, `npm run assets:export-characters`, and `npm run characters:capture`.

Synty/Mixamo sources, receipts, catalog metadata and hashes stay under `.local/`. Exported vendor art stays under `public/vendor/`, entirely ignored. Never send Synty files, textures or renders to ImageGen. Original text-prompted surfaces in `assets/textures/` are projected/baked locally.

### Required playable character and motions

The playable roster is Mixamo **Paladin J Nordstrom** (player, 1.8 m) and **Goblin D Shareyko** (enemy, 1.45 m). `assets/playable-characters.json` owns their URLs, heights and the default Paladin surface. Each has its own compatible catalog and five embedded combat motions plus a player-only dodge; additional curated clips load lazily. Scenery and the broader character gallery remain optional.

1. Keep the acquired character FBXs and motion sources under `.local/animation-packs/mixamo/`. If sources are missing, sign into Mixamo in Safari, select X Bot for motion acquisition, then run `npm run assets:download-mixamo` and paste the generated `.local/mixamo-download-console.js` into the Mixamo console. `--prepare-only` regenerates the helper; `--downloads` changes the receipt directory. Tokens stay in Safari and must never be logged or committed.
2. Run `npm run assets:export-character` with Blender installed locally. `--blender PATH` selects another executable. This prepares ten Paladin clips including dodge and seven Goblin clips, sampled at 30 fps with horizontal root travel removed. The compatibility command `npm run assets:export-animation-lab` runs this same preparation. The full source index stays private at `.local/animation-packs/mixamo/converted-source-catalog.json`; retired Viking playback exports are unnecessary.
3. Preparation projects the eight original text-prompted surfaces under `assets/textures/paladin/` locally into 2048-pixel UV bakes. It preserves skin islands, authored normal maps and gold trim, recolors cloth, and bakes metallic/roughness masks. No vendor asset or render is supplied to ImageGen. `--skip-projection` reuses complete projected models when only preparing motions. Models and baked maps remain ignored; prompts and original generated surfaces are tracked.
4. Run `npm run assets:check -- --playable`, then the browser smoke flows below. The player default uses the original authored Paladin textures. All projected palettes remain optional experiments. Local comparisons use `?paladin=authored`, `?paladin=dark-brass`, `?paladin=silver-gold`, `?paladin=ivory-gold`, `?paladin=grim-gold` or `?paladin=grim-crimson`. The character gallery also includes the eight projected variants, and the animation comparison lab uses the Paladin's compatible catalog.

The default Paladin set is sword-and-shield idle/run/slash/impact/death, with block idle, attack, alternate slash and alternate run. The Goblin uses Orc Idle, Running, standing melee attack horizontal, Hit Reaction and Dying, with another melee attack and run. Both preserve authored materials; parent normalization avoids altering animated rig transforms. Grip and foot-contact cleanup remains art work.

Run `python3 scripts/assets/mixamo/verify-mixamo-library.py --complete` when checking full catalog coverage and source hashes. Full-catalog verification is explicit, not a routine handoff step.

### Optional scenery and surface studies

The default prepared woodland uses weathered autumn foliage and warm-brown soil; authored surfaces remain available in development authoring. The environment manifest owns per-asset foliage targets, value scales and shadow/olive retention. Run `node scripts/assets/surfaces/environment.mjs --only pine,bush,fern` to rebake affected foliage locally. The exporter classifies original palette regions first, then recolors both foliage inputs while preserving geometry, alpha and hierarchy. Existing original PNGs and exact ImageGen prompts remain unchanged. Reload the owned preview before visual review and explicit lighting preparation; coordinate exports, GPU sessions and checks through the shared-checkout procedure.

Run `npm run assets:import` to regenerate pine, rock, chest and optional painted-rock output from `.local/synty-library/sources/`. Use `--source PATH` to select another local Polygon Viking Realm asset root. Run `npm run assets:export-ground` for the original ground study and `npm run assets:export-art-lab` for the coordinated surfaces used by the clearing; the latter also accepts `--source PATH`. These exporters remain available even though the former art-lab comparison route has retired. Missing optional scenery does not prevent the encounter from running.

`npm run assets:import-library` imports the wider private Synty library. `npm run assets:verify-library` performs its full coverage/geometry check. These remain explicit import operations. The importer needs Blender, Unity CLI/Unity 6000.6.2f1, and Python with Pillow. Use `--dry-run` for inventory only, `--pack` to select packs, and `--reuse-inventory` only to resume the last staged snapshot. Source FBX is preferred; Unity exports prefab/material/skin/LOD metadata and the ASCII FBX fallback converts locally through three.js. Downloaded scripts are not executed. Native Unity `.asset` meshes include collision/LOD geometry. The Alpine terrain height field exports as base geometry at up to 513×513 vertices; painted terrain layers remain archived for later integration. Pack-filtered imports retain other packs in the catalog. Unsupported engine resources and material approximations remain visible in private coverage/catalog records. Register production library IDs in `assets/library-selection.json`; staging includes their converted dependency closure. Prepared lighting uses its explicit bake index; other non-library vendor directories currently copy wholesale, including the animation catalog. `.local/build-inventory.json` records included vendor paths, sizes and total bytes; source archives are rejected. Review inventory and applicable vendor terms before any future build distribution. Source publication does not publish `dist/` or private vendor files.

## Script conventions

Build and verification entry points remain in `scripts/`. Asset preparation lives in `scripts/assets/`: `synty/` owns Synty import and library conversion, `mixamo/` owns acquisition and rig-compatible motion export, `surfaces/` owns original texture projection and baking, and `characters/` owns private roster conversion and gallery captures. Library helper siblings remain together under `synty/library/`. Repeated Node argument/process/path behavior belongs in `scripts/lib/cli.mjs`. Supported wrappers provide `--help`, reject unknown/repeated flags and missing values before writing, pass literal arguments without a shell, and fail on failed/interrupted children. Exit codes are 0 success, 1 operation failure, 2 invalid invocation. Export defaults resolve from the repository, not the caller's directory; explicitly supplied paths resolve from the caller. Python verifiers also resolve their defaults from the repository.

Long exports stream output. Checks retain complete local logs and print short stage results. Do not add asset regeneration, downloads or formatting to verification. Shared helpers are for demonstrated repetition, not a general scripting framework.

## Manual smoke flows

Use a real browser after gameplay edits, with prepared local art:

1. **Movement and victory:** open `/?area=clearing`, then move using WASD/arrows, confirm diagonal movement and camera follow, then approach/facing-strike the raider. Damage lands at animation contact rather than keypress. Two connected strikes win. Retreat beyond the camp leash to confirm the Goblin returns and recovers; approach again, win, open the chest and collect its two scrolls. The camp fire must block interaction/healing before victory and heal at 3% per second afterwards. Inspect original/painted rock when available; return to the encounter.
2. **Defeat and return:** engage and stand in reach without attacking. Five enemy hits lose. Return Home restores health and keyboard focus while retaining collected scrolls and enemy state. Travel back through the fire; use Options → Animations → Restart when deliberately resetting an encounter for an isolated test. Open/close Options and inspect rock to confirm combat pauses/resumes. Changing motions restarts when those controls are available.

3. **Home and return loop:** start at the clearing midpoint, walk home through the woodland entrance, verify safe movement and disabled scroll use at home, travel from the fire with E, collect a dropped scroll, cast from Inventory with B while moving/taking damage, enter the portal, heal gradually near the home fire, and return to the exact departure point. Confirm the portal closes, enemies/drops retain session state, and restarting retains scrolls/discovered fires but refreshes encounters.

Check default native WebGPU FSR Temporal, TAAU, TAA and Off, including FSR → TAAU → TAA startup fallback and actionable errors when native WebGPU is unavailable. No WebGL context may be created. Inspect the animation lab (`/?lab=animations`) when its wiring changes. Older art/renderer routes load the normal clearing without opening Options; use Escape to open it.

Automated Electron inspection always launches `desktop:check` or `--background`; attach CDP on loopback and confirm `visible:false`/`focused:false`. Own and close test processes; do not launch visible/focusable windows while the user works. Performance comparisons follow [the matched protocol](PERFORMANCE.md).

For aim/follow changes, check idle pointer turning, sideways/backward WASD movement with a stationary cursor, pointer exit and zoom. Each click commits its swing direction; moving the pointer during a swing or hit reaction takes effect when the action lock ends. WASD controls dodge direction when held; a stationary dodge uses the latest aim. Menus clear aim and require a fresh pointer event on return. Aim ignores points within 0.15 m of the player. Keep the current run clips; directional locomotion polish is deferred.

Camera defaults are a 0.15 m ground dead zone, 0.20 seconds of movement look-ahead capped at 0.65 m, and exponential easing at 8 per second. Lead stays off inside the dead zone and decays when actual movement stops, including wall collision. Check starts, stops, reversals, dodges, both zoom extremes and a narrow viewport; pointer turning alone must leave framing stable. Restart, travel and inspection return reset follow; frozen authoring views must remain deterministic.

## Publication

Review status, complete candidate paths and relevant diffs before staging. Original material uses [the project license](../LICENSE.md); third-party exceptions are recorded in [notices](../THIRD_PARTY_NOTICES.md). Never stage private art, receipts, credentials, captures or build products. Commit reviewed source changes and watch the exact pushed revision's CI until green when publication is requested. No website deployment, Steam integration or build distribution is configured.

## Known local contention

A September 30 foundation check passed both prepared and asset-free builds. Concurrent GPU/browser inspection coincided with a later typecheck deadline and browser-control stalls; typechecking passed after the owned sessions closed. Finish and close owned rendering sessions before the final gate; do not raise timeouts or change product behavior to hide contention.


## Current graphics options

Options contains Graphics and Animations; opening it pauses the encounter. The clearing is a woodland path and goblin camp with painterly soil and rocks; area selection and linked travel use the authored definitions described in [level design](LEVEL_DESIGN.md#entrances-exits-and-travel). Escape opens/closes the menu. The camera has a 35-degree downward pitch and default zoom 1.35; the wheel remains available. Existing area envelopes retain their authored dimensions.

FSR Temporal is the only reconstruction method. Resolution Quality offers Native (100%), Quality (1/1.5 per axis), Balanced (1/1.7) and Performance (50%). Balanced is the default; output pixel ratio is always 1. Sharpening ranges from 0 to 1, with fresh/reset default 0.50; saved choices survive. Shadow Quality and Particle Effects use independent High/Medium/Low presets. Native WebGPU or FSR startup failure produces an actionable error, with no alternate renderer or reconstruction fallback. Legacy method and render-scale preferences/URLs are ignored.

Temporary comparisons can use `?upscaleQuality=quality&sharpness=0.2` or `?upscaleQuality=performance`. `data-graphics` includes recent frame intervals, scene/output dimensions and FSR compute timings; these timings exclude scene rendering, the reactive opaque pass and later effects. Compare identical output buffers.

Frame rate limits are 60, 120, 144, 240, and Unlimited. The clearing defaults to 60 in browsers. Electron supplies its initial display's refresh rate; first launch/reset chooses the highest listed cap no higher than that rate (with a 1 Hz allowance for nominal rates), falling back to 60. Saved caps take precedence. Unlimited removes the application cap but retains requestAnimationFrame display pacing. Simulation and animation delta time includes skipped callbacks; the existing 50 ms stall clamp remains. The canvas follows the window size; Resolution Quality changes scene buffers rather than the monitor display mode.

Default effect strengths are Bloom 0.40 and Ambient occlusion 0.65. Depth of field offers Off, Soft and Cinematic, with Cinematic selected on fresh settings and reset. Soft uses focus range 24 and bokeh 0.8; Cinematic uses 16 and 1.6. Both track the camera target and run after FSR with jitter-corrected depth. Off bypasses DOF. Modes persist under the existing settings key; `?dof=off`, `?dof=soft` and `?dof=cinematic` override them temporarily. Invalid or old numeric DOF values use Cinematic. The character gallery explicitly keeps DOF Off. Exposure is 1.25, Firelight 0.85, and Atmosphere 0.70; fire shadows remain enabled. Atmosphere uses simple profile distance fog; volumetric rendering and bounded mist pockets remain retired. Atmospheric particles defaults to On, with density controlled by Particle Effects.

Settings revision 5 preserves existing applicable preferences, including saved sharpening, and strips retired settings. Options controls update immediately and submit snapshots once per presentation frame. Graph changes settle for 150 ms, with the latest selection flushed on close. Preparation is serialized; the last image remains visible and gameplay pauses during compilation. Failed replacements retain the working graph with an actionable menu error. HTML UI remains on the main thread, so cold shader preparation may still cause a measurable stall.

Electron uses a stable secure local origin so Options can persist across restarts. Hidden checks use a separate ignored profile and remain non-focusable. CLI --aa overrides the saved method. --renderer=webgpu is accepted only for compatibility; other backend values are rejected. All routes require a supported browser/OS/GPU and hardware acceleration; browser deployments require HTTPS (loopback development is supported).

Environment palette, material treatment, golden/silver entry selection and local surface preparation follow [the art direction](ART_DIRECTION.md).

## Lighting preparation

Shared profiles, local light recipes, automatic probe coverage, cache budgets, prepared bakes and fixed visual references are documented in [lighting authoring](LIGHTING.md). `npm run lighting:bake` is an explicit native WebGPU authoring operation; it never runs in routine checks or builds. Prepared atlases stay under ignored `public/vendor/lighting/`, with metadata-only references in `assets/lighting-bakes.json`.
