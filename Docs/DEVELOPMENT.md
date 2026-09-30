# Development workflow

Use Node 24 from `.node-version`, npm 11+, and `npm ci`. Direct reads and scoped `rg` are enough for discovery. Inspect status and relevant diffs before editing; preserve unrelated changes and re-read shared files during concurrent work.

## Commands and handoff

| Command | Role |
| --- | --- |
| `npm run dev` | Browser iteration on loopback |
| `npm run typecheck` | Runtime, tests and Vite/Vitest configuration types |
| `npm test` | Small Node simulation suite |
| `npm run docs:check` | Maintained local Markdown links and npm command names |
| `npm run build` | Typecheck, stage private runtime art, and build |
| `npm run preview` | Serve the built renderer locally |
| `npm run smoke:preview` | Owned preview server and HTML/JS/CSS response checks |
| `npm run assets:check` | Available local runtime assets and selected-library closure |
| `npm run assets:check -- --playable` | Require character and compatible default Mixamo motions |
| `npm run check` | Docs, types, tests, one build, asset/build inventory, preview, diff whitespace |
| `npm run desktop` | Build and open a visible window for requested manual play |
| `npm run desktop:run` | Visible manual play of an existing build |
| `npm run desktop:check -- --debug-port=9231` | Hidden non-focusable Electron; attach CDP |

Run focused checks during work, then `check` once after the final edit. It retains stage logs and passed/failed/skipped outcomes under ignored `.local/checks/`; failures skip later stages and exit nonzero. The gate typechecks once and calls the build's internal skip-typecheck option. Standalone build still typechecks. Exporters never run from checks.

Asset-free CI runs this same gate from tracked sources. Build/resource success does not prove playable art, gameplay correctness or GPU performance. Report those separately. Tests protect important established outcomes; do not pursue counts, percentages, per-mechanic browser coverage, or redundant assertions. Styling and documentation do not need new tests.

## Private asset workflow

Keep Topaz read-only. Synty/Mixamo sources, receipts, catalog metadata and hashes stay under `.local/`. Exported vendor art stays under `public/vendor/`, entirely ignored. Never send Synty files, textures or renders to ImageGen. Original text-prompted surfaces in `assets/textures/` are projected/baked locally.

1. Install Blender locally. Node exporter wrappers default to `/Applications/Blender.app/Contents/MacOS/Blender` and `../Topaz`; use `--blender`/`--topaz` for other locations.
2. Run `npm run assets:import -- --topaz /path/to/Topaz` for pine, rock, chest and optional painted-rock output. Run `npm run assets:export-ground` and `npm run assets:export-art-lab` for the original ground and coordinated surface studies.
3. Sign into Mixamo in Safari and select X Bot as the acquisition rig. Start `npm run assets:download-mixamo`. Paste the generated `.local/mixamo-download-console.js` into the Mixamo console and leave the tab open. The collector stores FBX/ZIP exports privately and removes only task-owned download receipts. Tokens remain in Safari and must never be logged or committed. `--prepare-only` regenerates the helper; `--downloads` changes Safari's receipt directory.
4. Run `python3 scripts/verify-mixamo-library.py --complete` for catalog coverage and source hashes. Full-catalog verification is explicit, not a routine handoff step.
5. Run `npm run assets:export-animation-lab`, then `npm run assets:export-character`. First export uses one worker; `--jobs 4` reuses the exported warrior, shards motion conversion and merges manifests only after all workers finish successfully. IDs prevent duplicate names overwriting outputs. Completed unchanged clips reuse local outputs. The export retains vertical hip motion, removes horizontal travel and bakes to the Synty warrior at 30 fps.
6. Run `npm run assets:check -- --playable`, then the browser smoke flows below. The standalone character contains five retained motions; additional catalog clips load lazily. Grip and foot-contact cleanup remains art work.

`npm run assets:import-library` imports the wider private Synty library. `npm run assets:verify-library` performs its full coverage/geometry check. These remain explicit import operations. The importer needs Blender, Unity CLI/Unity 6000.6.2f1, and Python with Pillow. Use `--dry-run` for inventory only, `--pack` to select packs, and `--reuse-inventory` only to resume the last staged snapshot. Source FBX is preferred; Unity exports prefab/material/skin/LOD metadata and the ASCII FBX fallback converts locally through three.js. Downloaded scripts are not executed. Unsupported engine resources and material approximations remain visible in private coverage/catalog records. Register production library IDs in `assets/library-selection.json`; staging includes their converted dependency closure. All non-library vendor directories currently copy wholesale, including the animation catalog. `.local/build-inventory.json` records included vendor paths, sizes and total bytes; source archives are rejected. Review inventory and applicable vendor terms before any future build distribution. Source publication does not publish `dist/` or private vendor files.

## Script conventions

Entry points remain in `scripts/`; repeated Node argument/process/path behavior belongs in `scripts/lib/cli.mjs`. Supported wrappers provide `--help`, reject unknown/repeated flags and missing values before writing, pass literal arguments without a shell, and fail on failed/interrupted children. Exit codes are 0 success, 1 operation failure, 2 invalid invocation. Export defaults resolve from the repository, not the caller's directory; explicitly supplied paths resolve from the caller. Python verifiers also resolve their defaults from the repository.

Long exports stream output. Checks retain complete local logs and print short stage results. Do not add asset regeneration, downloads or formatting to verification. Shared helpers are for demonstrated repetition, not a general scripting framework.

## Manual smoke flows

Use a real browser after gameplay edits, with prepared local art:

1. **Movement and victory:** move using WASD/arrows, confirm diagonal movement and camera follow, then approach/facing-strike the raider. Damage lands at animation contact rather than keypress. Four connected strikes win. Inspect original/painted rock when available; return to the encounter.
2. **Defeat and retry:** engage and stand in reach without attacking. Five enemy hits lose. Retry restores health/positions and keyboard focus; movement starts a fresh encounter. Open/close Options and inspect rock to confirm combat pauses/resumes. Changing motions restarts when those controls are available.

Check WebGL SMAA (`/?renderer=webgl&aa=smaa`) and native WebGPU temporal AA (`/?renderer=webgpu&aa=traa`), including actionable fallback. Inspect the animation lab (`/?lab=animations`) when its wiring changes. Older art/renderer routes now lead to the normal clearing's Options UI.

Automated Electron inspection always launches `desktop:check` or `--background`; attach CDP on loopback and confirm `visible:false`/`focused:false`. Own and close test processes; do not launch visible/focusable windows while the user works. Performance comparisons follow [the matched protocol](PERFORMANCE.md).

## Publication

Review status, complete candidate paths and relevant diffs before staging. Original material uses [the project license](../LICENSE.md); third-party exceptions are recorded in [notices](../THIRD_PARTY_NOTICES.md). Never stage private art, receipts, credentials, captures or build products. Commit reviewed source changes and watch the exact pushed revision's CI until green when publication is requested. No website deployment, Steam integration or build distribution is configured.

## Known local contention

A September 30 foundation check passed both prepared and asset-free builds. Concurrent GPU/browser inspection coincided with a later typecheck deadline and browser-control stalls; typechecking passed after the owned sessions closed. Finish and close owned rendering sessions before the final gate; do not raise timeouts or change product behavior to hide contention.
