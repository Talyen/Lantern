# Desktop candidates and diagnostic reports

Lantern is developed on macOS; Windows x64 is the primary Steam release target. The current desktop deliverable is an unsigned ZIP containing the executable and supporting files. Electron Forge also produces a native-architecture macOS ZIP for local inspection. Installers, signing/notarization, automatic updates and Steam integration are deferred.

## Window and UI minimum

The supported game-content viewport starts at 1280 × 800, matching [Steam Deck’s display](https://www.steamdeck.com/en/tech), with common 16:9/16:10 desktops as the primary range. Electron sizes content explicitly and derives its minimum outer size from the OS frame. When the available work area cannot contain that viewport, startup fits the display; those smaller windows are not supported-size acceptance. Steam Deck fullscreen/SteamOS, native WebGPU compatibility, gamepad navigation and physical-device performance require future validation. This minimum is a UI layout target, not Deck Verified certification.

## Prepare and distribute a candidate

Use the [managed task workflow](DEVELOPMENT.md#working-alongside-other-agents) for source changes. Prepare distributables from a clean, reviewed, committed revision after integration. The packaging implementation does not push, create releases or dispatch remote work automatically.

1. Run `npm run desktop:prepare` on the Mac with the prepared gameplay art present. It builds through the existing asset staging process, verifies both playable characters and the output inventory, adds notices/build identity, and produces `.local/desktop/lantern-web-FULL_SHA.tar.gz`. This archive contains the **complete playable web build**, including `index.html`, compiled gameplay, and only selected runtime art; it is not a reusable vendor-art collection. Sources, unused exports, gallery content, credentials and local evidence stay out.
2. Record the printed full revision and `playtest-FIRST_12_SHA_CHARACTERS` tag. Verify an archive independently with `npm run desktop:verify -- --archive .local/desktop/lantern-web-FULL_SHA.tar.gz --revision FULL_SHA`. Verification rejects missing/extra files, unsupported archives, mismatched hashes and mismatched/dirty build identities.
3. When publication is intended, push that exact source revision through the usual authorized Git workflow. Then run `npm run desktop:publish -- --archive .local/desktop/lantern-web-FULL_SHA.tar.gz --tag playtest-FIRST_12_SHA_CHARACTERS`. This explicit command creates a **public, unencrypted GitHub prerelease** in Talyen/Lantern. It uses the authenticated GitHub CLI; it never pushes source. Do not overwrite an existing candidate tag or asset. Review the staging inventory and applicable asset purchase terms before distribution, as required by [asset preparation](ASSET_PREPARATION.md).
4. Run `npm run desktop:dispatch -- --tag playtest-FIRST_12_SHA_CHARACTERS`. The manually dispatched **Windows desktop candidate** workflow checks out the tag's revision, verifies and installs its prepared content, and creates a Windows x64 ZIP without rebuilding gameplay or converting assets. Follow it with `gh run list --repo Talyen/Lantern --workflow desktop-windows.yml`, then `gh run watch RUN_ID --repo Talyen/Lantern`.
5. Download the ZIP from the successful workflow's artifacts. Artifacts in this public repository are downloadable by signed-in GitHub users and expire after 30 days; they are not private playtest storage. Download with `gh run download RUN_ID --repo Talyen/Lantern --name Lantern-windows-x64-playtest-FIRST_12_SHA_CHARACTERS` or the GitHub run page. The prepared web build remains on the public prerelease.

For local macOS inspection, `npm run desktop:package` packages the content left by preparation; it does not rebuild it. Output lives under `.local/desktop/out/make/zip/`. Packaging requires clean source, checks the manifest against the current checkout, verifies the completed application archive against the allowlist and content hashes, and keeps only the Electron shell, prepared `dist/`, application metadata and included notices. Bundled gameplay does not need Node modules in the application. Electron's own Chromium/Node notices remain in its packaged distribution.

The Windows PC needs no Git, Node, or editor. Extract the entire Windows ZIP to a new folder and launch `Lantern.exe`; do not move the executable away from its supporting files. Unsigned candidates may trigger operating-system prompts. Native WebGPU remains mandatory; a startup failure must be investigated rather than adding a second renderer.

## Local diagnostic export

Choose **Export diagnostic report** in Options or beside a startup failure. Browser builds download JSON; Electron opens a native save dialog. Cancelling leaves the game unchanged. Export failures offer a retry.

Reports include build version/revision and dirty-source status, platform/runtime versions, graphics settings and initialization, missing asset identifiers, audio status, save persistence status and the latest bounded failure records. They do not collect raw saves, character inventories or player state. Error text is bounded and scrubs URL values, personal filesystem paths and common credential assignments. No report is uploaded automatically.

The collector starts before gameplay imports. It records startup failures, uncaught errors, rejected promises, uncaptured GPU errors and unexpected GPU device loss. Electron retains the latest report at `diagnostics.json` in its user-data directory, independently of the renderer. The latest crash also remains in `diagnostics-last-crash.json` across relaunches. A visible renderer termination offers native export; hidden automated checks retain the file without opening a dialog. Report updates are limited to selected status and failure data. Desktop IPC is restricted to the main application frame and exposes no general filesystem API.

## Manual Windows acceptance

Use the actual candidate package at normal settings. Record its full source revision, Windows version, GPU model/driver, display resolution and the exported diagnostic report alongside the result.

- Launch the extracted game. Confirm the authored scene and characters load, and the report identifies native WebGPU and ready FSR Temporal.
- Move, attack, swap weapon sets and dodge briefly; check camera, character/effect readability and audio.
- Travel between Homestead and Forest Clearing. Check that the destination loads and controls remain usable.
- Make one persistent inventory or gathering change, close the game normally, and relaunch from the same package. Confirm progress survives.
- Open Options and export a report; confirm its build revision matches the candidate and it includes no save/inventory payload or personal paths.

Report failures with the candidate revision, a short reproduction and exported diagnostics. Packaging/static CI success does not establish Windows GPU compatibility, visual quality or cross-platform performance. Until this interaction is completed on Windows, Windows hardware acceptance remains outstanding. This procedure is candidate validation, not a benchmark, recurring test schedule or requirement to install a development environment.

## Rendering upgrade policy

Keep the pinned three.js and FSR integration and existing rendering defaults. The next rendering change or dependency upgrade must include focused initialization/history/error checks appropriate to the changed seam plus visual inspection; no broad rendering rewrite or new reconstruction method is part of desktop packaging. Save export/import and hosted telemetry remain deferred.
