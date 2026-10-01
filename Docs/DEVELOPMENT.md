# Development workflow

Use Node 24 from `.node-version`, npm 11+, and `npm ci`. Direct reads and scoped `rg` are enough for discovery. Inspect status and relevant diffs before editing; preserve unrelated changes and re-read shared files during concurrent work.

## Working alongside other agents

Use one private Git worktree per task. The main checkout stays on `main` and is written by the integration command; the user's integrated preview stays at `http://127.0.0.1:5173`. Task source/index, dependencies, caches, exports and profiles are independent. Routine work needs no messages or path reservations.

1. Run `npm run agent:start -- --task <slug>` in main. Use the printed directory as the working directory for every edit and command. The script creates `codex/<slug>` and resumes an existing registered task. One agent owns that worktree through integration.
2. Implement the feature. For player-facing work, use `npm run agent:dev -- --browser` to start one isolated native WebGPU browser; `--author --area clearing` enables existing level tools. Inspect one representative result and exercise the changed interaction. `agent:dev` without `--browser` serves source without consuming the GPU-review slot. Stop the owned session with `npm run agent:dev -- --stop`.
3. Put explicitly reviewed repository-relative paths in an ignored JSON list, for example `.local/reviewed-paths.json`. Run `npm run agent:finish -- --paths .local/reviewed-paths.json --message "feat: describe the completed behavior"`. The command commits those paths, rebases onto local main, runs the change-aware sanity gate and fast-forwards main when the tested baseline still matches. It stops the task preview first. No push or PR is created.
4. On a rebase conflict, repair it in the private worktree, run `git rebase --continue`, and retry finish. Failed checks return their log and leave main untouched. Repeat a visual inspection only if repair or integration changed the inspected behavior. The task owner continues until integrated.
5. Run `npm run agent:cleanup -- --task <slug>` from main after integration. It closes owned processes and removes only a clean completed worktree, retaining private source directories under `.local/agent-archives/<slug>/`. Branch history remains recoverable. Unexpected source/asset edits prevent cleanup.

`npm run agent:status` reports task paths, preview URLs, lifecycle/check state, promotion journal and free disk space. Registry and OS-managed locks live under Git's common directory, so every worktree sees the same state. Locks release when their owning process exits; no age-based lock stealing. A durable promotion journal lets the next start/finish/main-preview operation complete interrupted promotion. Unexpected main changes require agent repair and are never reset or stashed away.

Finish stages only named reviewed paths and refuses a pre-existing staged index. Commit before the final checks so `check --base <sha>` examines candidate changes, not just a clean working-tree diff. Checks belong to their exact revision/assets; main advancing triggers preparation and relevant checks again. Broken candidates never block unrelated tasks from attempting promotion.

### Copyable task example

For a documentation task, start in main and switch to the exact `Directory:` printed by the command (the default location is shown here):

```sh
cd /Users/ryanmcintire/Documents/Lantern
npm run agent:start -- --task menu-docs
cd /Users/ryanmcintire/Documents/Lantern/.local/worktrees/menu-docs
# Edit and review the intended documentation paths here.
mkdir -p .local
cat > .local/reviewed-paths.json <<'JSON'
["Docs/DEVELOPMENT.md"]
JSON
npm run agent:finish -- --paths .local/reviewed-paths.json --message "docs: clarify menu workflow"
# After finish reports integration, return to main for cleanup.
cd /Users/ryanmcintire/Documents/Lantern
npm run agent:cleanup -- --task menu-docs
```

Replace the example slug, reviewed paths and commit message with the task's actual scope. A documentation task needs no preview; player-facing tasks use their one relevant private preview before finish.

### Private assets and resource use

Worktrees stay on main's filesystem. Native macOS `clonefile` creates independent asset/dependency copies sharing initial storage; ordinary writes allocate changed blocks. Node's clone-copy option is unsupported on this machine and is not used. There is no silent large-copy fallback. Do not use writable symlinks or hardlinks. Clone sizes are logical, not additional physical disk usage.

Prepared `public/vendor` assets are privately cloned at task creation. Run `npm run agent:sources -- --sources animation-packs,synty-library` only for source directories the asset task needs. Never copy `.local` wholesale or install dependencies in another task. Matching lockfile/runtime dependencies are cloned; changed dependencies trigger owned `npm ci`.

The October 1 demonstration measured about 57 MiB of tracked source per worktree and 2.4 GiB of prepared vendor files as logical clones. Roughly 17 GiB of original sources remain lazy and are prepared only for asset work. Initial task setup took 18.5/18.1 seconds before the clone-helper optimization; subsequent setups took 13.6/11.3 seconds. Background disk activity was present, so these observations are neither guaranteed setup timings nor precise physical storage costs per task.

Finish combines current main assets with task-edited artifacts before checking. Overlapping different outputs return `needs-asset-repair`. Reconcile/re-export them against main, then provide `--resolved-assets <json-file>` naming the reviewed conflicted vendor-relative paths. That acknowledgement is bound to the recorded main revision and conflicted artifact hashes; newer source or artifact changes require another reconciliation. Unchanged source archives are not repeatedly hashed.

Automatic limits are four task worktrees, two lightweight check jobs (two Vitest workers each), one heavy build/export/install, and one agent GPU-review session. Resource waiting is recorded separately from execution time. A queued build waits before its execution deadline begins and does not hold a lightweight-check slot. These limits do not close or change the user's own play session. Previews start on demand; closing them releases the GPU resource. Level capture/measure/bake operations borrow their verified owned authoring session's lease.

Local/private-asset operations require 20 GiB available disk; admission also refuses a fifth live worktree. Asset-free CI with no private vendor/source directories uses a 1 GiB reserve, since [standard hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) advertise 14 GB storage. CI containing private inputs retains the 20 GiB reserve. If disk space or task slots are exhausted, the agent runs `agent:status`, cleans completed tasks with `agent:cleanup`, and retries without asking the user to manage resources. Preserve unfinished tasks and source archives. Cleanup retains successful/failure check evidence and preview logs alongside private sources in `.local/agent-archives/<slug>/`. Staging and production public files also use native clones. Successful check evidence replaces older successful evidence; failure evidence is retained. Captures replace the same task/view output rather than collecting a settings matrix.

### Migration

The October 1 shared-checkout work was drained and committed as a settled baseline before this workflow was enabled. New tasks use the scripts; legacy advisory notes are historical aids, not locks. Main source must be clean before admission or promotion. Never checkpoint unfinished work simply to satisfy that condition.

## Level authoring

Use the persistent preview and captures in [level design](LEVEL_DESIGN.md): `npm run levels:dev`, `npm run levels:capture`, `npm run levels:check`, `npm run levels:assets`, `npm run levels:measure`, and `npm run levels:stop`. Use one representative view; `levels:capture -- --all` is an explicit batch. Close owned sessions after review. Ordinary scene-data edits need no build/export/restart.

When a capture helps review an area, run these from its task worktree with the owned authoring preview active:

```sh
npm run levels:capture -- --area clearing                # One center view (default)
npm run levels:capture -- --area clearing --view center  # One named view
# Optional batch only when the change warrants it:
npm run levels:capture -- --area clearing --all          # All authored views and overview
```

Choose one single-view command for ordinary review. Only `--all` creates a contact sheet; it cannot be combined with `--view`.

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
| `npm run check` | Change-aware sanity checks; no ordinary production build |
| `npm run check:full` | Complete production/build gate for CI and requested readiness |
| `npm run agent:start` / `agent:finish` | Private task creation and automatic local integration |
| `npm run agent:dev` / `main:dev` | Private and integrated previews |
| `npm run agent:status` / `agent:cleanup` | Lifecycle/resource inspection and safe cleanup |
| `npm run desktop` | Build and open a visible window for requested manual play |
| `npm run desktop:run` | Visible manual play of an existing build |
| `npm run desktop:check -- --debug-port=9231` | Hidden non-focusable Electron; attach CDP |

Run a focused check only when it helps an implementation decision, then the lean final gate once. Runtime code runs rendering policy, types, the existing small test suite and whitespace. Documentation-only changes run links/whitespace; level/docs validators run when relevant inputs change. CSS-only changes need their representative preview and cheap policy/whitespace checks. Packaging, dependencies, exported assets or build configuration trigger build/inventory/resource checks. Explicit `check:full` retains all stages and CI uses it.

`check --base <sha>` validates committed candidate whitespace and collects changes relative to the integration baseline. It records inputs, timings and stage logs in ignored `.local/checks/`, reuses successful checks only for matching inputs, and rejects a source/asset change during validation. Neither mode downloads, exports, bakes, benchmarks or launches browser-review matrices.

Default acceptance is one preview session and one relevant interaction at normal settings. No new test is required unless it protects an important established behavior. Broaden checks only for an observed failure, consequential save migration, renderer initialization/dependency change or explicitly requested audit/release; record the reason briefly. Build/resource checks do not prove visual quality or platform performance. Finish reports the completed behavior, sanity check and material limits.

## Private asset workflow

See [character preview](CHARACTERS.md) for the complete model gallery, `npm run assets:export-characters`, and `npm run characters:capture`.

Synty/Mixamo sources, receipts, catalog metadata and hashes stay under `.local/`. Exported vendor art stays under `public/vendor/`, entirely ignored. Never send Synty files, textures or renders to ImageGen. Original text-prompted surfaces in `assets/textures/` are projected/baked locally.

### Required playable character and motions

The playable roster is Mixamo **Paladin J Nordstrom** (player, 1.8 m) and **Goblin D Shareyko** (enemy, 1.45 m). `assets/playable-characters.json` owns their URLs, heights and the default Paladin surface. Each has its own compatible catalog and base combat motions plus directional/weapon actions and a player-only dodge; selected clips load lazily. The [animation review](ANIMATIONS.md) owns source selection and visual evidence. Scenery and the broader character gallery remain optional.

1. Keep the acquired character FBXs and motion sources under `.local/animation-packs/mixamo/`. If sources are missing, sign into Mixamo in Safari, select X Bot for motion acquisition, then run `npm run assets:download-mixamo` and paste the generated `.local/mixamo-download-console.js` into the Mixamo console. `--prepare-only` regenerates the helper; `--downloads` changes the receipt directory. Tokens stay in Safari and must never be logged or committed.
2. Run `npm run assets:export-character` with Blender installed locally. `--blender PATH` selects another executable. This prepares the manifest-selected Paladin/Goblin weapon profiles and all 17 previous comparison sources, sampled at 30 fps with horizontal root travel removed and reviewed timing cooked into the clips. `--motions-only` reuses retained surfaces, repacks compatible motions and refreshes gallery references. The compatibility command `npm run assets:export-animation-lab` runs this same preparation. The full source index stays private at `.local/animation-packs/mixamo/converted-source-catalog.json`; retired Viking playback exports are unnecessary.
3. Preparation projects the eight original text-prompted surfaces under `assets/textures/paladin/` locally into 2048-pixel UV bakes. It preserves skin islands, authored normal maps and gold trim, recolors cloth, and bakes metallic/roughness masks. No vendor asset or render is supplied to ImageGen. `--skip-projection` reuses complete projected models when only preparing motions. Models and baked maps remain ignored; prompts and original generated surfaces are tracked.
4. Run `npm run assets:check -- --playable`, then one relevant browser flow when accepting changed playable art. The player default uses the original authored Paladin textures. All projected palettes remain optional experiments. Local comparisons use `?paladin=authored`, `?paladin=dark-brass`, `?paladin=silver-gold`, `?paladin=ivory-gold`, `?paladin=grim-gold` or `?paladin=grim-crimson`. The character gallery also includes the eight projected variants, and the animation comparison lab uses the Paladin's compatible catalog.

The player starts with an Axe; Axe, Sword, Shield, Bow and Staff select coherent compatible motion profiles. Goblin retains Orc Idle with an Axe walking stride, compact Axe attack/reaction and falling-back death. Exact source IDs, trims and markers belong to `assets/motion-profiles.json`; titles are never selection keys. Parent normalization preserves authored rig transforms/materials. Full finger mapping, calibrated gait contacts and authored grips remain subject to the visual review in [animations](ANIMATIONS.md).

Run `python3 scripts/assets/mixamo/verify-mixamo-library.py --complete` when checking full catalog coverage and source hashes. Full-catalog verification is explicit, not a routine handoff step.

### Optional scenery and surface studies

The default prepared woodland uses weathered autumn foliage and warm-brown soil; authored surfaces remain available in development authoring. The environment manifest owns per-asset foliage targets, value scales and shadow/olive retention. Run `node scripts/assets/surfaces/environment.mjs --only pine,bush,fern` to rebake affected foliage locally. The exporter classifies original palette regions first, then recolors both foliage inputs while preserving geometry, alpha and hierarchy. Existing original PNGs and exact ImageGen prompts remain unchanged. Reload the owned preview before visual review and explicit lighting preparation; use the task workflow and automatic export/GPU resource leases.

Run `npm run assets:import` to regenerate pine, rock, chest and optional painted-rock output from `.local/synty-library/sources/`. Use `--source PATH` to select another local Polygon Viking Realm asset root. Run `npm run assets:export-ground` for the original ground study and `npm run assets:export-art-lab` for the coordinated surfaces used by the clearing; the latter also accepts `--source PATH`. These exporters remain available even though the former art-lab comparison route has retired. Missing optional scenery does not prevent the encounter from running.

`npm run assets:import-library` imports the wider private Synty library. `npm run assets:verify-library` performs its full coverage/geometry check. These remain explicit import operations. The importer needs Blender, Unity CLI/Unity 6000.6.2f1, and Python with Pillow. Use `--dry-run` for inventory only, `--pack` to select packs, and `--reuse-inventory` only to resume the last staged snapshot. Source FBX is preferred; Unity exports prefab/material/skin/LOD metadata and the ASCII FBX fallback converts locally through three.js. Downloaded scripts are not executed. Native Unity `.asset` meshes include collision/LOD geometry. The Alpine terrain height field exports as base geometry at up to 513×513 vertices; painted terrain layers remain archived for later integration. Pack-filtered imports retain other packs in the catalog. Unsupported engine resources and material approximations remain visible in private coverage/catalog records. Register production library IDs in `assets/library-selection.json`; staging includes their converted dependency closure. Prepared lighting uses its explicit bake index; other non-library vendor directories currently copy wholesale, including the animation catalog. `.local/build-inventory.json` records included vendor paths, sizes and total bytes; source archives are rejected. Review inventory and applicable vendor terms before any future build distribution. Source publication does not publish `dist/` or private vendor files.

## Script conventions

Build and verification entry points remain in `scripts/`. Asset preparation lives in `scripts/assets/`: `synty/` owns Synty import and library conversion, `mixamo/` owns acquisition and rig-compatible motion export, `surfaces/` owns original texture projection and baking, and `characters/` owns private roster conversion and gallery captures. Library helper siblings remain together under `synty/library/`. Repeated Node argument/process/path behavior belongs in `scripts/lib/cli.mjs`. Supported wrappers provide `--help`, reject unknown/repeated flags and missing values before writing, pass literal arguments without a shell, and fail on failed/interrupted children. Exit codes are 0 success, 1 operation failure, 2 invalid invocation. Export defaults resolve from the repository, not the caller's directory; explicitly supplied paths resolve from the caller. Python verifiers also resolve their defaults from the repository.

Long exports stream output. Checks retain complete local logs and print short stage results. Do not add asset regeneration, downloads or formatting to verification. Shared helpers are for demonstrated repetition, not a general scripting framework.

## Optional targeted smoke references

Choose the relevant portion for the changed behavior. These flows are a reference menu, not a completion checklist. One short representative flow normally suffices:

1. **Movement and victory:** open `/?area=clearing`, then move using WASD/arrows, confirm diagonal movement and camera follow, then approach/facing-strike the raider. Damage lands at animation contact rather than keypress. Two connected strikes win. Retreat beyond the camp leash to confirm the Goblin returns and recovers; approach again, win, open the chest and collect its two scrolls. The camp fire must block interaction/healing before victory and heal at 3% per second afterwards. Inspect original/painted rock when available; return to the encounter.
2. **Defeat and return:** engage and stand in reach without attacking. Five enemy hits lose. Return Home restores health and keyboard focus while retaining collected scrolls and enemy state. Travel back through the fire; use Options → Animations → Restart when deliberately resetting an encounter for an isolated test. Open/close Options and inspect rock to confirm combat pauses/resumes. Changing motions restarts when those controls are available.

3. **Home and return loop:** start at the clearing midpoint, walk home through the woodland entrance, verify safe movement and disabled scroll use at home, travel from the fire with E, collect a dropped scroll, cast from Inventory with B while moving/taking damage, enter the portal, heal gradually near the home fire, and return to the exact departure point. Confirm the portal closes, enemies/drops retain session state, and restarting retains scrolls/discovered fires but refreshes encounters.

For the solo caster, open `/?area=clearing&enemy=caster`: approach into sight, read its windup, sidestep/dodge the committed straight bolt, and attack during recovery. Damage interrupts windup. The normal route retains the raider; travel/death retains the chosen solo enemy and its session health/rewards.

Use default native WebGPU FSR Temporal. Renderer initialization/dependency changes may warrant a focused unsupported-WebGPU/FSR error probe; no reconstruction or WebGL fallback exists. Inspect the animation lab (`/?lab=animations`) only when its changed behavior needs review. Older art/renderer routes load the normal clearing without opening Options; use Escape to open it.

Automated Electron inspection always launches `desktop:check` or `--background`; attach CDP on loopback and confirm `visible:false`/`focused:false`. Own and close test processes; do not launch visible/focusable windows while the user works. Performance comparisons follow [the matched protocol](PERFORMANCE.md).

For aim/follow changes, check idle pointer turning, sideways/backward WASD movement with a stationary cursor, pointer exit and zoom. Each click commits its swing direction; moving the pointer during a swing or hit reaction takes effect when the action lock ends. WASD controls dodge direction when held; a stationary dodge uses the latest aim. Menus clear aim and require a fresh pointer event on return. Aim ignores points within 0.15 m of the player. Check the calibrated forward/backward/strafe families, transitions into contact poses, and half-speed directional walking while blocking.

Camera defaults are a 0.15 m ground dead zone, 0.20 seconds of movement look-ahead capped at 0.65 m, and exponential easing at 8 per second. Lead stays off inside the dead zone and decays when actual movement stops, including wall collision. Check starts, stops, reversals, dodges, both zoom extremes and a narrow viewport; pointer turning alone must leave framing stable. Restart, travel and inspection return reset follow; frozen authoring views must remain deterministic.

4. **Equipment and gathering:** win the camp, open its chest, equip all four rewards, and confirm equipment never respawns enemies or duplicates rewards. Attack after victory and at home; Bow/Staff release at their markers and terrain blocks projectiles. Hold right mouse with a Shield, test front/rear hits and movement, then dodge to release it. Hold E near any standing tree with an Axe: step into chopping range, collect three Wood / 30 Woodcutting XP, observe a stump and cleared collision, travel away/back, and confirm regrowth after 120 active gameplay seconds without lighting preparation. Inventory, movement, damage, attack and dodge must interrupt chopping. Restart preserves items/XP/Wood but refreshes trees.

## Publication

Review status, complete candidate paths and relevant diffs before staging. Original material uses [the project license](../LICENSE.md); third-party exceptions are recorded in [notices](../THIRD_PARTY_NOTICES.md). Never stage private art, receipts, credentials, captures or build products. Commit reviewed source changes and watch the exact pushed revision's CI until green when publication is requested. No website deployment, Steam integration or build distribution is configured.

## Known local contention

A September 30 foundation check passed both prepared and asset-free builds. Concurrent GPU/browser inspection coincided with a later typecheck deadline and browser-control stalls; typechecking passed after the owned sessions closed. Managed resource leases now queue agent GPU reviews and heavy operations. Close owned rendering sessions after inspection; do not raise timeouts or change product behavior to hide contention.


## Current graphics options

Outlines offers On/Off, defaults and resets to On, and preserves saved choices. Temporary `?outlines=on|off` comparisons do not change preferences. It applies stronger warm-charcoal contours to actors/equipment and quieter contours to known solid props, excluding terrain, plants, scatter and effects. Contours run before FSR and remain inside visible surfaces so existing motion/depth rejection applies. Their footprint targets 1.7 output pixels, with a one-scene-texel minimum at lower reconstruction resolutions and smooth coverage. For an outline change, briefly inspect the affected silhouette in motion at normal settings. Thin weapons, alternate reconstruction settings and occlusion probes are optional targeted diagnostics.

Options contains Graphics and Animations; opening it pauses the encounter. The clearing is a woodland path and goblin camp with painterly soil and rocks; area selection and linked travel use the authored definitions described in [level design](LEVEL_DESIGN.md#entrances-exits-and-travel). Escape opens/closes the menu. The camera has a 35-degree downward pitch and default zoom 1.35; the wheel remains available. Existing area envelopes retain their authored dimensions.

FSR Temporal is the only reconstruction method. Resolution Quality offers Native (100%), Quality (1/1.5 per axis), Balanced (1/1.7) and Performance (50%). Balanced is the default; output pixel ratio is always 1. Sharpening ranges from 0 to 1, with fresh/reset default 0.50; saved choices survive. Shadow Quality and Particle Effects use independent High/Medium/Low presets. Native WebGPU or FSR startup failure produces an actionable error, with no alternate renderer or reconstruction fallback. Legacy method and render-scale preferences/URLs are ignored.

Temporary comparisons can use `?upscaleQuality=quality&sharpness=0.2` or `?upscaleQuality=performance`. `data-graphics` includes recent frame intervals, scene/output dimensions and FSR compute timings; these timings exclude scene rendering, the reactive opaque pass and later effects. Compare identical output buffers.

Frame rate limits are 60, 120, 144, 240, and Unlimited. The clearing defaults to 60 in browsers. Electron supplies its initial display's refresh rate; first launch/reset chooses the highest listed cap no higher than that rate (with a 1 Hz allowance for nominal rates), falling back to 60. Saved caps take precedence. Unlimited removes the application cap but retains requestAnimationFrame display pacing. Simulation and animation delta time includes skipped callbacks; the existing 50 ms stall clamp remains. The canvas follows the window size; Resolution Quality changes scene buffers rather than the monitor display mode.

Default effect strengths are Bloom 0.40 and Ambient occlusion 0.65. Depth of field offers Off, Soft and Cinematic, with Cinematic selected on fresh settings and reset. Soft uses focus range 24 and bokeh 0.8; Cinematic uses 16 and 1.6. Both track the camera target and run after FSR with jitter-corrected depth. Off bypasses DOF. Modes persist under the existing settings key; `?dof=off`, `?dof=soft` and `?dof=cinematic` override them temporarily. Invalid or old numeric DOF values use Cinematic. The character gallery explicitly keeps DOF Off. Exposure is 1.25, Firelight 0.85, and Atmosphere 0.70; fire shadows remain enabled. Atmosphere uses simple profile distance fog; volumetric rendering and bounded mist pockets remain retired. Atmospheric particles defaults to On, with density controlled by Particle Effects.

Settings revision 5 preserves existing applicable preferences, including saved sharpening, and strips retired settings. Options controls update immediately and submit snapshots once per presentation frame. Graph changes settle for 150 ms, with the latest selection flushed on close. Preparation is serialized; the last image remains visible and gameplay pauses during compilation. Failed replacements retain the working graph with an actionable menu error. HTML UI remains on the main thread, so cold shader preparation may still cause a measurable stall.

Electron uses a stable secure local origin so Options can persist across restarts. Hidden checks use a separate ignored profile and remain non-focusable. CLI --aa overrides the saved method. --renderer=webgpu is accepted only for compatibility; other backend values are rejected. All routes require a supported browser/OS/GPU and hardware acceleration; browser deployments require HTTPS (loopback development is supported).

Environment palette, material treatment, the fixed Golden woodland baseline and local surface preparation follow [the art direction](ART_DIRECTION.md).

## Lighting preparation

Shared profiles, local light recipes, automatic probe coverage, cache budgets, prepared bakes and fixed visual references are documented in [lighting authoring](LIGHTING.md). `npm run lighting:bake` is an explicit native WebGPU authoring operation; it never runs in routine checks or builds. Prepared atlases stay under ignored `public/vendor/lighting/`, with metadata-only references in `assets/lighting-bakes.json`.
