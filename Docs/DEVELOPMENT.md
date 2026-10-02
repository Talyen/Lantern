# Development workflow

Use Node 24 from `.node-version`, npm 11+, and `npm ci`. Direct reads and scoped `rg` are enough for discovery. Inspect status and relevant diffs before editing; preserve unrelated changes and re-read shared files during concurrent work.

## Working alongside other agents

Use one private Git worktree per task. The main checkout stays on `main` and is written by the integration command; the user's integrated preview stays at `http://127.0.0.1:5173`. Task source/index, dependencies, caches, exports and profiles are independent. Routine work needs no messages or path reservations.

1. Run `npm run agent:start -- --task <slug>` in main. Use the printed directory as the working directory for every edit and command. The script creates `codex/<slug>` and resumes an existing registered task. Admission waits when all worktree slots are occupied; Ctrl+C cancels the wait, or add `--no-wait` to fail immediately at capacity. Resuming a registered task does not need another slot. Cleaned task slugs remain archived; choose a fresh slug for new work. One agent owns that worktree through integration.
2. Implement the feature. For player-facing work, use `npm run agent:dev -- --browser` to start one isolated native WebGPU browser; `--author --area clearing` enables existing level tools. Inspect one representative result and exercise the changed interaction. `agent:dev` without `--browser` serves source without consuming the GPU-review slot. Stop the owned session with `npm run agent:dev -- --stop`.
3. Put explicitly reviewed repository-relative paths in an ignored JSON list, for example `.local/reviewed-paths.json`. Run `npm run agent:finish -- --paths .local/reviewed-paths.json --message "feat: describe the completed behavior"`. The command commits those paths, rebases onto local main, runs the change-aware sanity gate and fast-forwards main when the tested baseline still matches. This applies to documentation tasks too. It stops the task preview first. No push or PR is created.
4. On a rebase conflict, repair it in the private worktree, run `git rebase --continue`, and retry finish. Failed checks return their log and leave main untouched. Repeat a visual inspection only if repair or integration changed the inspected behavior. The task owner continues until integrated.
5. Run `npm run agent:cleanup -- --task <slug>` from main after integration. It closes owned processes and removes only a clean completed worktree, retaining private source directories under `.local/agent-archives/<slug>/`. Branch history remains recoverable. Unexpected source/asset edits prevent cleanup.

`npm run agent:status` reports used/total worktree capacity, task paths, preview URLs, lifecycle/check state, promotion journal and free disk space. Registry and OS-managed locks live under Git's common directory, so every worktree sees the same state. Locks release when their owning process exits; no age-based lock stealing. A durable promotion journal lets the next start/finish/main-preview operation complete interrupted promotion. Unexpected main changes require agent repair and are never reset or stashed away.

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

Prepared `public/vendor` assets are privately cloned at task creation. Run `npm run agent:sources -- --sources animation-packs,synty-library` only for source directories the asset task needs. Never copy `.local` wholesale or install dependencies in another task. Matching lockfile/runtime dependencies are cloned; readiness also checks installed direct dependencies against their locked versions. Changed dependencies or an incomplete/stale clone trigger owned `npm ci`.

The October 1 demonstration measured about 57 MiB of tracked source per worktree and 2.4 GiB of prepared vendor files as logical clones. Roughly 17 GiB of original sources remain lazy and are prepared only for asset work. Initial task setup took 18.5/18.1 seconds before the clone-helper optimization; subsequent setups took 13.6/11.3 seconds. Background disk activity was present, so these observations are neither guaranteed setup timings nor precise physical storage costs per task.

Finish combines current main assets with task-edited artifacts before checking. Overlapping different outputs return `needs-asset-repair`. Reconcile/re-export them against main, then provide `--resolved-assets <json-file>` naming the reviewed conflicted vendor-relative paths. That acknowledgement is bound to the recorded main revision and conflicted artifact hashes; newer source or artifact changes require another reconciliation. Unchanged source archives are not repeatedly hashed.

Automatic limits default to eight task worktrees, one static-check job, one heavy build/export/install, and one agent GPU-review session. Worktree capacity is independent of these resource leases: more source-editing tasks do not admit more GPU reviews or heavy jobs. Resource waiting is recorded separately from execution time. A queued build waits before its execution deadline begins and does not hold a lightweight-check slot. These limits do not close or change the user's own play session. Previews start on demand; closing them releases the GPU resource. Level capture/measure/bake operations borrow their verified owned authoring session's lease. Retired second-slot locks drain without terminating their owners and remain reserved so older worktrees cannot admit another job. These are managed-command limits, not a hardware cap on external apps.

Set a repository-local override with `git config --local lantern.maxWorktrees 12`; remove it with `git config --local --unset lantern.maxWorktrees` to restore eight. The setting must be a positive integer and is shared by every worktree. Lowering it preserves existing tasks and waits for usage to fall below the new limit. Every task not yet cleaned consumes a slot, including integrated tasks awaiting cleanup. Admission releases the promotion lock while waiting so other tasks can finish and be cleaned.

Local/private-asset operations require 20 GiB available disk; admission waits at the configured worktree limit. Asset-free CI with no private vendor/source directories uses a 1 GiB reserve, since [standard hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) advertise 14 GB storage. CI containing private inputs retains the 20 GiB reserve. If disk space or task slots are exhausted, the agent runs `agent:status`, cleans completed tasks with `agent:cleanup`, and retries without asking the user to manage resources. Preserve unfinished tasks and source archives. Cleanup retains successful/failure check evidence and preview logs alongside private sources in `.local/agent-archives/<slug>/`. Staging and production public files also use native clones. Successful check evidence replaces older successful evidence; failure evidence is retained. Captures replace the same task/view output rather than collecting a settings matrix.

### Migration

The October 1 shared-checkout work was drained and committed as a settled baseline before this workflow was enabled. New tasks use the scripts; legacy advisory notes are historical aids, not locks. Main source must be clean before admission or promotion. Never checkpoint unfinished work simply to satisfy that condition.

## Level authoring

Use the persistent preview and captures in [level design](LEVEL_DESIGN.md): `npm run levels:dev`, `npm run levels:capture`, `npm run levels:check`, `npm run levels:assets`, `npm run levels:measure -- --reason "request or defect evidence"` only when authorized by the performance policy, and `npm run levels:stop`. Use one representative view; `levels:capture -- --all` is an explicit batch. Close owned sessions after review. Ordinary scene-data edits need no build/export/restart.

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
| `npm run lint` | Managed ESLint, Ruff Python correctness and Stylelint CSS checks; no automatic fixes |
| `npm test -- tests/encounter.test.ts` | Explicit focused test for a concrete failure; one local worker |
| `npm test` | Full unit suite in CI (two workers); local full-suite use requires a user request |
| `npm run docs:check` | Local links, heading fragments and npm command names in root Markdown, `Docs/` and `.agents/`, including archives |
| `npm run levels:check` | Area definitions, gate links, library selections and optional-art warnings |
| `npm run build` | Explicit asset/packaging validation or requested build readiness; typecheck, stage private runtime art, and build |
| `npm run preview` | Serve the built renderer locally |
| `npm run smoke:preview` | CI HTTP resource smoke; does not execute gameplay or WebGPU |
| `npm run assets:check` | Available local runtime assets and selected-library closure |
| `npm run assets:check -- --playable` | Require character and compatible default Mixamo motions |
| `npm run check` | Change-aware sanity checks; no ordinary production build |
| `npm run check:full` | Complete CI gate; requested local use requires `-- --allow-local` |
| `npm run agent:start` / `agent:finish` | Private task creation and automatic local integration |
| `npm run agent:dev` / `main:dev` | Private and integrated previews |
| `npm run agent:status` / `agent:cleanup` | Lifecycle/resource inspection and safe cleanup |
| `npm run desktop` | Build and open a visible window for requested manual play |
| `npm run desktop:run` | Visible manual play of an existing build |
| `npm run desktop:check -- --debug-port=9231` | Hidden non-focusable Electron; attach CDP |

Run the light final gate once. Code changes run rendering policy, types, lint and whitespace. Documentation-only changes run links/whitespace; level/docs validators run when relevant inputs change. CSS-only changes need their representative preview and cheap policy, CSS lint and whitespace checks. Python changes run Ruff; lint configuration/rule changes also run the existing policy fixtures locally. Packaging, dependencies, exported assets and build configuration do not automatically trigger suites or builds. Validate affected prepared-art output and references explicitly; build staging is reserved for a focused asset/packaging need or user-requested readiness. `check --assets` adds asset validation without building.

[ESLint configuration](../eslint.config.js) keeps JavaScript correctness checks across tooling/Electron and adds type-aware safety checks in application source, tests and the Vite/Vitest configurations. Detached promises require an explicit rejection handler even when prefixed with `void`; await or return asynchronous assertions. Application union switches must handle every case explicitly, including when a default exists. TypeScript owns undefined names and unused variables; its compatibility preset avoids redundant core checks. Lint rejects explicit `any`, unsafe inferred values, unnecessary assertions, misused spreads and unbound application methods. Parse external JSON through [the unknown-value boundary](../src/data/json.ts), then validate it in its owning save/preference schema. Promise rejection callback parameters use `unknown`; detached callbacks explicitly declare `this: void` or retain their receiver. Type-only imports use `import type` or inline `type` specifiers. `@ts-ignore` and `@ts-nocheck` are forbidden, while `@ts-expect-error` needs a description of at least ten characters. Equality uses `===`/`!==`, with deliberate `== null`/`!= null` checks permitted.

Private assets, worktrees, generated outputs and build evidence are excluded. Suppressions and inline rule configurations need a reason after `--`; disables must name specific rules. [The lint runner](../scripts/lint.mjs) audits directive comments independently with inline suppression disabled, so a directive cannot suppress its own validation. Obsolete suppressions and redundant inline configurations still fail. The signed-in Mixamo browser script retains its browser globals and collector placeholder. Lint checks every active source file and rejects warnings; it never formats, fixes, downloads, runs Python/Blender or prepares assets.

[Ruff settings](../ruff.config.json) enable Python syntax errors and Pyflakes (`E9`, `F`). The pinned official Ruff Node/WASM package is installed by `npm ci`, with no separate Python lint environment; its experimental API is covered by policy fixtures and must be revalidated on upgrades. Python discovery uses tracked and unignored files, excluding generated files and skipping deletions. [Stylelint settings](../stylelint.config.js) catch unknown properties, units/functions, invalid comments and duplicate declarations while allowing consecutive fallback values. `npm run lint` checks all three languages; `npm run lint -- --javascript`, `npm run lint -- --python` and `npm run lint -- --css` select a language. Managed resource limits still serialize lint jobs. Custom policy fixtures run in CI and in the lean gate when lint configuration, rules or their runner change. Local investigation may also use `node scripts/agents/run.mjs --resource checks -- node --test eslint/rules.test.mjs` explicitly.

CI runs all three lint languages and their policy fixtures, unit/workflow suites, build/inventory validation and HTTP smoke on Linux; a small hosted macOS job runs workflow/resource tests including APFS coverage. Triggers remain pull requests, main pushes and manual dispatch. Local integration uses the light gate and may precede CI. Pushes require a user request; local finishing does not push or wait for remote CI. Future automated E2E is CI-first; there is currently no maintained browser E2E suite. Native WebGPU and licensed-art requirements must be resolved before adding one.

Keep automated tests focused on established gameplay, save/inventory safety, resource ownership and asynchronous failure behavior. Use small deterministic fixtures instead of full authored scenery or stress matrices; `levels:check` validates the current area files. Avoid assertions that merely repeat decorative tuning tables. Workflow integration tests run in CI, including macOS coverage. A focused local test may investigate a concrete failure or validate consequential resource-ownership changes; full local suites require a user request. Test-only changes use the light gate, with no gameplay preview.

`check --base <sha>` validates committed candidate whitespace and collects changes relative to the integration baseline. It records inputs, timings and stage logs in ignored `.local/checks/`, records the light/full mode and executed stages, reuses successful checks only for matching inputs and mode, and rejects a source/asset change during validation. Neither mode downloads, exports, bakes, benchmarks or launches browser-review matrices.

Default acceptance is one preview session and one relevant interaction at normal settings. No new test is required unless it protects an important established behavior. Broaden local functional inspection only for an observed failure, consequential save migration or renderer initialization/dependency change; record the reason briefly. Audits and release readiness do not automatically authorize local full suites or performance testing. Build/resource checks do not prove visual quality or platform performance. Finish reports the completed behavior, sanity check and material limits.

## Private asset workflow

Gameplay audio preparation, private source provenance, optimized output and event coverage are owned by [gameplay sound](AUDIO.md). `npm run audio:prepare` is explicit; routine checks and builds only validate/stage selected prepared files.

See [character preview](CHARACTERS.md) for the complete model gallery, `npm run assets:export-characters`, and `npm run characters:capture`.

Synty/Mixamo sources, receipts, catalog metadata and hashes stay under `.local/`. Exported vendor art stays under `public/vendor/`, entirely ignored. Never send Synty files, textures or renders to ImageGen. Original text-prompted surfaces in `assets/textures/` are projected/baked locally.

### Required playable character and motions

The playable roster is Mixamo **Paladin J Nordstrom** (player, 1.8 m) and **Goblin D Shareyko** (enemy, 1.45 m). `assets/playable-characters.json` owns their model URLs and heights. Each has its own compatible catalog and base combat motions plus directional/weapon actions and a player-only dodge; selected clips load lazily. The [animation review](ANIMATIONS.md) owns source selection and visual evidence. Scenery and the broader character gallery remain optional.

1. Keep the acquired character FBXs and motion sources under `.local/animation-packs/mixamo/`. If sources are missing, sign into Mixamo in Safari, select X Bot for motion acquisition, then run `npm run assets:download-mixamo` and paste the generated `.local/mixamo-download-console.js` into the Mixamo console. `--prepare-only` regenerates the helper; `--downloads` changes the receipt directory. Tokens stay in Safari and must never be logged or committed.
2. In a task worktree, first clone the needed private sources with `npm run agent:sources -- --sources animation-packs`. Run `npm run assets:export-character` with Blender installed locally. `--blender PATH` selects another executable. This prepares the manifest-selected Paladin/Goblin weapon profiles and all 17 previous comparison sources, sampled at 30 fps with horizontal root travel removed and reviewed timing cooked into the clips. `--motions-only` reuses authored models, repacks compatible motions and refreshes gallery references. The full source index stays private at `.local/animation-packs/mixamo/converted-source-catalog.json`; retired Viking playback exports are unnecessary.
3. Preparation preserves each character’s original authored textures and packs its compatible default motions into the playable model. `--player-only` limits preparation to Paladin; `--motions-only` updates motions without re-exporting authored models.
4. Run `npm run assets:check -- --playable`, then one relevant browser flow when accepting changed playable art. Gameplay loads the equipped weapon profile directly. Use the development animation lab for comparisons.

Retired Paladin palettes, original ground/painted-rock studies and their preparation recipes are privately archived with hashes under `.local/animation-packs/Archives/repo-cleanup/` in the cleanup task. Task cleanup retains them under main’s `.local/agent-archives/repo-cleanup/animation-packs/Archives/repo-cleanup/`. Existing licensed source catalogs and private exports are preserved. These experiments are absent from active manifests and game builds.

New characters start with an Axe; Axe, Sword, Shield, Bow and Staff select coherent compatible motion profiles. Goblin retains Orc Idle with an Axe walking stride, compact Axe attack/reaction and falling-back death. Exact source IDs, trims and markers belong to `assets/motion-profiles.json`; titles are never selection keys. Parent normalization preserves authored rig transforms/materials. Full finger mapping, calibrated gait contacts and authored grips remain subject to the visual review in [animations](ANIMATIONS.md).

Run `python3 scripts/assets/mixamo/verify-mixamo-library.py --complete` when checking full catalog coverage and source hashes. Full-catalog verification is explicit, not a routine handoff step.

### Lossless surface channel packing

Run `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/pack.mjs` explicitly after preparing environment surfaces; `--only pine,rock,chest` limits families. It preserves color, normal RGB, roughness and metalness bytes and folds height into metallic/roughness red, eligibility into its alpha, and cavity into normal alpha. Version-3 material metadata selects those channels; legacy versions 1/2 remain supported. The separate relief texture is no longer a runtime dependency. Source GLBs and relief PNGs are hash-archived under `.local/synty-library/Archives/packed-surfaces/`; task cleanup preserves them. Routine checks/builds never repack art.

### GPU-compressed scenery

The optional chest, tent and pine preparation trial embeds UASTC KTX2 textures, with original dimensions, full mip chains and unchanged 16× material filtering. The default prepared art retains its original PNG textures: the local trial reduced logical GPU allocations, but concurrent work in other projects prevented a reliable system-memory comparison. Compressed candidates remain private and opt-in pending controlled acceptance. The stock pinned three.js decoder is bundled by Vite; the prototype permits generated JavaScript for its local scripts while retaining CSP resource restrictions and Electron isolation. No renderer fallback is introduced.

Preparation is explicit: `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/compress.mjs --encoder /absolute/path/to/toktx`. Optional `--only chest,tent,pine` narrows the selected families. KTX-Software's local encoder uses UASTC quality 3 and lossless Zstandard level 9, with two threads. Original prepared GLBs are hash-archived under `.local/synty-library/Archives/compressed-surfaces/originals/`; task cleanup preserves that source archive. Re-exporting surfaces restores ordinary PNG GLBs until compression is explicitly run again. Checks/builds never encode textures.

### Optional scenery and surface studies

The default Clearing/Homestead material treatment uses normal maps and spatial roughness/cavity fields on the prepared environment set. Texture Depth controls POM, defaults to On and preserves existing saved preferences. Fixed 16× material filtering has no menu control. Character maps remain authored.

Prepare the tracked original ground data explicitly with `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/environment.mjs --ground-fields`. Prepare selected scenery with the same wrapper and `environment.mjs [--only pine,rock,...]`. This generates embedded tangent normals and private `*-surface.png` sidecars beside the GLBs; their version-2 material metadata owns URL/depth; opaque RGB stores height/cavity/POM eligibility, with roughness retained in the embedded map and staging includes that dependency. The exporter keeps original color sources, uses 2048-pixel bakes for prominent families and 1024 for supporting props, and prepares conservative rock bevels/pine shaping. Missing relief sidecars retain baked color/normal surfaces and report incomplete art. Reload the owned preview after exporting; do not rebake through routine checks or builds.


For the bounded weathered woodland study, open `/?author=levels&area=clearing&surfaces=showcase` in an owned preview, or choose **Woodland showcase** in the authoring Surfaces selector. This selects the existing `entrance` view; use Play to walk, fight and chop with the same gameplay runtime. Projected restores the current prepared surfaces. The option is development-only and does not change normal gameplay defaults.

Prepare its two private GLBs explicitly with `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/environment.mjs --showcase`. Recipes and placement/ground selection belong to [the environment manifest](../assets/textures/environment/manifest.json); original material sources and exact text-only prompts/hashes belong to [showcase sources](../assets/textures/environment/showcase/sources.json). Keep derived GLBs under ignored `public/vendor/synty/environment/showcase/`. Missing showcase exports report incomplete art and retain current prepared scenery. Reload the owned preview after rebaking; runtime ground layers and shader parameters participate in lighting fingerprints. No routine check regenerates these exports or lighting.

The default prepared woodland uses weathered autumn foliage and warm-brown soil; authored surfaces remain available in development authoring. The environment manifest owns per-asset foliage targets, value scales and shadow/olive retention. Run `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/environment.mjs --only pine,bush,fern` to rebake affected foliage locally. The exporter classifies original palette regions first, then recolors both foliage inputs while preserving geometry, alpha and hierarchy. Existing original PNGs and exact ImageGen prompts remain unchanged. Reload the owned preview before visual review and explicit lighting preparation; use the task workflow and automatic export/GPU resource leases.

Run `npm run assets:import` to regenerate the standalone chest and authored/painterly cliff rock from `.local/synty-library/sources/`. Use `--source PATH` to select another local Polygon Viking Realm asset root. Existing `/vendor/synty/chest.glb` and `/vendor/synty/art-lab/rock*.glb` URLs remain stable for area definitions and lighting fingerprints. Ground uses the tracked soil texture directly; no ground GLB export is needed. Missing optional scenery does not prevent the encounter from running.

`npm run assets:import-library` imports the wider private Synty library. `npm run assets:verify-library` performs its full coverage/geometry check. These remain explicit import operations. The importer needs Blender, Unity CLI/Unity 6000.6.2f1, and Python with Pillow. Use `--dry-run` for inventory only, `--pack` to select packs, and `--reuse-inventory` only to resume the last staged snapshot. Source FBX is preferred; Unity exports prefab/material/skin/LOD metadata and the ASCII FBX fallback converts locally through three.js. Downloaded scripts are not executed. Native Unity `.asset` meshes include collision/LOD geometry. The Alpine terrain height field exports as base geometry at up to 513×513 vertices; painted terrain layers remain archived for later integration. Pack-filtered imports retain other packs in the catalog. Unsupported engine resources and material approximations remain visible in private coverage/catalog records. Register production library IDs in `assets/library-selection.json`; staging includes their converted dependency closure. Prepared lighting uses its explicit bake index. Other vendor staging follows playable models and catalog clips, area references, the environment manifest and their file dependencies. The gallery, alternate Paladin palettes, unused exports and conversion sidecars are excluded; both labs are development-only. `.local/build-inventory.json` records included vendor paths, sizes and total bytes; source archives are rejected. Review inventory and applicable vendor terms before any future build distribution. Source publication does not publish `dist/` or private vendor files.

## Script conventions

Build and verification entry points remain in `scripts/`. Asset preparation lives in `scripts/assets/`: `synty/` owns Synty import and library conversion, `mixamo/` owns acquisition and rig-compatible motion export, `surfaces/` owns original texture projection and baking, and `characters/` owns private roster conversion and gallery captures. Library helper siblings remain together under `synty/library/`. Repeated Node argument/process/path behavior belongs in `scripts/lib/cli.mjs`. Supported wrappers provide `--help`, reject unknown/repeated flags and missing values before writing, pass literal arguments without a shell, and fail on failed/interrupted children. Exit codes are 0 success, 1 operation failure, 2 invalid invocation. Export defaults resolve from the repository, not the caller's directory; explicitly supplied paths resolve from the caller. Python verifiers also resolve their defaults from the repository.

Long exports stream output. Checks retain complete local logs and print short stage results. Do not add asset regeneration, downloads or formatting to verification. Shared helpers are for demonstrated repetition, not a general scripting framework.

## Optional targeted smoke references

These references are the canonical browser review menu. Private smoke scripts from earlier forest, Homestead, HUD, camera, lighting, environment-art, DOF and renderer experiments are retired; their recorded evidence remains historical. Retired runnable copies are kept with `.retired` suffixes and a hash manifest under ignored `.local/test-archives/lean-tests/`; captures, reports and source archives stay in their original locations. Do not replay them as a regression suite or recreate a full gameplay script for each visual change. `smoke:preview` checks built HTTP resources without launching a browser; neither sanity gate starts GPU rendering.

Choose the relevant portion for the changed behavior at normal settings, in one owned preview session. These flows are a reference menu, not a completion checklist. One short representative flow normally suffices:

1. **Movement and victory:** open `/?area=clearing`, then move using WASD/arrows and confirm diagonal movement and camera follow. Approach the raider, retreat beyond the camp leash while it is alive, and confirm it returns and recovers. Approach again and land two Basic strikes to defeat the camp guard; damage lands at animation contact rather than keypress, and the separate caster remains available. Click the chest and collect its scroll/potion rewards. The camp fire must block interaction/healing while threatened and heal at 3% per second once safe. Inspect original/painted rock when relevant.
2. **Defeat and return:** engage and stand in reach without attacking or blocking. Five enemy hits lose. Return Home restores health and keyboard focus while retaining collected items and enemy state. Walk back through the woodland entrance, or use fire travel if the clearing destination is safe; use development authoring’s Restart when deliberately resetting an encounter for an isolated test. Open/close Options to confirm combat pauses/resumes; authoring’s Inspect rock toggles the scenery view.
3. **Home and return loop:** start at the clearing midpoint, walk home through the woodland entrance, verify safe movement and disabled scroll use at home, click the fire to open Travel, collect a dropped scroll, cast from Inventory with B while moving/taking damage, enter the portal, heal gradually near the home fire, and return to the exact departure point. Confirm the portal closes, enemies/drops retain session state, and restarting retains scrolls/discovered fires but refreshes encounters.
4. **Equipment and gathering:** win the camp, open its chest, equip all four rewards, and confirm equipment never respawns enemies or duplicates rewards. Attack after victory and at home; Bow/Staff release at their markers and terrain blocks projectiles. Hold the slot assigned to Shield Basic with a Shield, test front/rear hits and movement, then dodge to release it. Left-click a tree with any combat loadout to approach and gather, collect three Wood / 30 Woodcutting XP at novice level without Rested, observe a stump and cleared collision, travel away/back, and confirm regrowth after 120 active gameplay seconds without lighting preparation. Inventory, movement, damage, attack and dodge must interrupt chopping. Restart preserves items, XP, materials, shelter, stash and Rested but refreshes resources. See [gathering and shelter](GATHERING.md) for the focused home loop.

For the solo caster, follow the left branch of the woodland approach to the glade at `[-10, -5]` in the normal clearing. Read its windup, sidestep/dodge the committed straight bolt, and attack during recovery. Damage interrupts windup. The camp guard stays inactive during this fight; travel/death retains each enemy's session health/defeat and rewards independently. The camp chest requires its guard's defeat. There is no query-selected replacement scenario.

Use default native WebGPU FSR Temporal. Renderer initialization/dependency changes may warrant a focused unsupported-WebGPU/FSR error probe; no reconstruction or WebGL fallback exists. Inspect the animation lab (`/?lab=animations`) only when its changed behavior needs review. Older art/renderer routes load the normal clearing without opening Options; use Escape to open it.

Automated Electron inspection always launches `desktop:check` or `--background`; attach CDP on loopback and confirm `visible:false`/`focused:false`. Own and close test processes; do not launch visible/focusable windows while the user works. Performance comparisons require a specific user request or evidenced performance defect and follow [the matched protocol](PERFORMANCE.md).

For aim/follow changes, check idle pointer turning, sideways/backward WASD movement with a stationary cursor, pointer exit and zoom. Each click commits its swing direction; moving the pointer during a swing or hit reaction takes effect when the action lock ends. WASD controls dodge direction when held; a stationary dodge uses the latest aim. Menus clear aim and require a fresh pointer event on return. Aim ignores points within 0.15 m of the player. Check the calibrated forward/backward/strafe families, transitions into contact poses, and half-speed directional walking while blocking.

Use viewport/zoom variants, cache pressure, missing-bake injection and animation comparisons only for a concrete change or failure in that subsystem. Performance measurements require a specific user request or an evidenced performance defect, with `levels:measure --reason "request or defect evidence"`. Routine feature work, audits, release-readiness gates and scheduled automation must not benchmark. Future automation uses the same managed resource limits and CI-first testing policy; no recurring test or benchmark job is created by default. Routine gameplay or visual changes do not require those matrices. Renderer initialization/dependency changes require checking native startup and actionable unsupported-WebGPU/FSR preparation errors, including affected development routes; never assert a reconstruction fallback. Keep managed previews, single-view captures and measurement tools available on demand.

Camera defaults are a 0.15 m ground dead zone, 0.20 seconds of movement look-ahead capped at 0.65 m, and exponential easing at 8 per second. Lead stays off inside the dead zone and decays when actual movement stops, including wall collision. Check starts, stops, reversals, dodges, both zoom extremes and a narrow viewport; pointer turning alone must leave framing stable. Restart, travel and inspection return reset follow; frozen authoring views must remain deterministic.

## Publication

Review status, complete candidate paths and relevant diffs before staging. Original material uses [the project license](../LICENSE.md); third-party exceptions are recorded in [notices](../THIRD_PARTY_NOTICES.md). Never stage private art, receipts, credentials, captures or build products. Commit reviewed source changes and watch the exact pushed revision's CI until green when publication is requested. No website deployment, Steam integration or build distribution is configured.

## Known local contention

A September 30 foundation check passed both prepared and asset-free builds. Concurrent GPU/browser inspection coincided with a later typecheck deadline and browser-control stalls; typechecking passed after the owned sessions closed. Managed resource leases now queue agent GPU reviews and heavy operations. Close owned rendering sessions after inspection; do not raise timeouts or change product behavior to hide contention.


## Current graphics options

See [graphics settings](GRAPHICS.md) for current controls, defaults, comparison URLs and settings persistence. [Gameplay sound](AUDIO.md) owns the Sound controls in the same Options menu.

## Lighting preparation

The sole shared Golden preset, local light recipes, automatic probe coverage, cache budgets, prepared bakes and fixed visual references are documented in [lighting authoring](LIGHTING.md). `npm run lighting:bake` is an explicit native WebGPU authoring operation; it never runs in routine checks or builds. Prepared atlases stay under ignored `public/vendor/lighting/`, with metadata-only references in `assets/lighting-bakes.json`.

## Combat controls and focused acceptance

Defaults use WASD/arrows to move and Shift to dodge. The six action slots use **Q, E, R, G, LMB, RMB**; **F** uses a Health Potion, **T** uses a Scroll of Return, **Tab** swaps weapon sets, **K** opens Skills, **B** opens Inventory, and **Escape** opens Options or closes a menu. Wheel zoom is remappable alongside the other controls in Options → Keybindings. Preferences have primary/secondary inputs and apply only after resolving conflicts and binding every movement direction.

Left-click loot or a usable chest, fire, portal, tree, mineral deposit, shelter or stash to approach and interact. Hover identifies its visible shape with a restrained brass contour. A resource starts automatic chopping/mining with a temporary basic tool; no owned tool is required. Movement, damage, combat actions, menus and travel interrupt it. Shield blocking is a hold-activated Shield Basic assigned through Skills.

For action-bar or keybinding changes, choose the relevant portion of this flow in one owned normal-settings session: acquire camp rewards, configure Sword + Shield in set I and Bow in set II, assign their Basics and Skills, activate the fixed bar to switch automatically, and verify cooldowns persist. Use/release Shield Basic, heal with F, cast with T, click a tree/chest, and apply/cancel a remapping including a mouse input and secondary movement. Restart when verifying saved equipment/assignments/preferences. Toggle cosmetic Outlines off when checking that interaction highlighting remains independent. Source motion audition and focused migration/simulation checks are targeted supplements; no full gameplay matrix is required.

Performance testing requires a specific user request or an evidenced performance defect, recorded with `levels:measure --reason "request or defect evidence"`. It borrows the owned authoring preview's single GPU lease. Routine handoff does not measure.

## Equipment acceptance

[Combat and equipment](EQUIPMENT.md) owns the full shared layout, fixed catalog values, guaranteed reward sources and revision 6 save compatibility. Use one short owned preview to collect, compare and equip gear, confirm armor and attack-rate behavior, swap prepared sets, choose ring destinations and reload. No resource refill occurs on equipment changes. Preserve the native WebGPU pipeline and original Paladin appearance.
