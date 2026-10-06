# Performance and renderer evidence

Ordinary feature work follows the [lean task workflow](DEVELOPMENT.md#working-alongside-other-agents): one relevant preview and fast sanity checks. Benchmarking and the matched protocol below require a specific user request or an evidenced performance defect. Routine feature work, audits, release-readiness gates and scheduled automation must not benchmark. Managed scripts queue one heavy operation, one check job and up to two agent GPU inspections while leaving the user's play session alone.

Use matched local measurements to judge changes; performance numbers are advisory, not CI gates. Browser resource smoke does not execute the renderer.

Use [current graphics](GRAPHICS.md), [water authoring](LEVEL_DESIGN.md#reusable-water-surfaces) and source owners for current behavior. Measure current authored areas on target hardware only when requested or warranted by an evidenced defect.

## Quality and performance acceptance

The acceptance baseline is foreground Safari on the Apple M5 / 16 GiB Mac, at a recorded normal viewport and native physical output. Target adventure entry within 10 seconds for a fresh browser/resource cache, and within 3 seconds for cached page reload, Return to Title/Continue, and repeat prepared-area travel. Time from accepted entry/travel input to the fully drawn, revealed, usable destination; human menu/name-entry time is excluded. OS/driver shader caches are outside application control and must be disclosed, not silently treated as cleared.

Typical gameplay should approach steady 60 fps: presentation median near 16.7 ms and p95 below 20 ms on the target 60 Hz surface, with CPU/GPU work measured independently when available. Compare Homestead, moving Clearing combat, and Crypt. Verify viewport, native adapter, visibility/focus, settings, scene/camera/motion, source/art identity and cache state. Exclude hidden/throttled runs from acceptance. Timestamp-query limitations require controlled per-stage comparisons, not invented GPU timings. Pipeline-promise duration includes callback/main-thread delay and is not isolated GPU compilation time.

Maintain a cost ledger for shader generation, pipeline preparation, asset transfer/decode/upload, lighting validation and steady rendering stages. Effects above 1 ms/frame or 0.5 seconds of startup require explicit visual-benefit review; these are Lantern review thresholds, not universal industry limits. Expensive effects with only small/moderate benefit should be simplified, replaced or omitted. Keep essential feedback clear. Improve quality and cost together; native output is fixed to physical pixels, while FSR internal resolution and effect design carry the performance trade-offs. Recommend the best-looking FSR mode that meets the budget, and report unmet targets honestly.

Do not confuse passes with duplicated work: a cheap depth/normal pass can be justified, but a second fully shaded opaque world needs a measured benefit. Authored scene-reflecting water still owns a half-scene-resolution capture per elevation; `worldPasses` includes those reflection captures; screen AO now reuses beauty depth instead of adding geometry. Environment reflection avoids that capture. Shadow maps and postprocessing are additional work, so the world count is not a total GPU-pass count. Prefer shared buffers, bounded reusable resources, immutable preparation metadata and fewer shader variants. Prepare static work explicitly offline and keep runtime fallback/authoring costs visible. Full local test suites remain out of scope unless separately requested.

## Current rendering policy

Lantern requires native WebGPU across gameplay, authoring and labs through the shared graph. FSR Temporal is the sole reconstruction method. Output matches the physical drawable viewport, and internal-resolution presets are evaluated against the frame budget. There is no reconstruction fallback; WebGPU/FSR startup failure produces an actionable error. Independent Shadow Quality and Particle Effects presets replace the overloaded quality setting. Atmosphere is simple profile distance fog; volumetric rendering is retired.

When measurements are requested or an evidenced performance defect warrants them, measure the current shared native pipeline and authored areas. Retired renderers and former settings are not acceptance baselines.

## Current measurement protocol

Run a fresh production build before measuring. Use hidden `npm run desktop:check -- --debug-port=9231` and attach CDP, or use a real browser. Keep GPU acceleration enabled. Record hardware, OS, browser/Electron and three.js versions, native WebGPU adapter, content viewport, scene/output dimensions, actual physical output pixel ratio, FSR Resolution Quality and sharpening, graphics settings, camera, and asset set. Use [current graphics settings](GRAPHICS.md) for controls and temporary overrides.

Use the quick iteration tier first: `npm run levels:measure -- --quick --area homestead --reason "requested optimization"` reuses the already loaded area, warms for 0.5 seconds, clears previous samples, then samples for two wall-clock seconds. The sample does not extend at low FPS; fewer than 30 intervals is inconclusive and still useful evidence of a severe stall. Record sample count, median, p95, mean cadence, worst interval, stalls above 50 ms and variability. The profiler records managed heavy work before/after sampling and marks contended runs inconclusive without waiting for other tasks. Also record external GPU workloads and sustained thermal state when comparing results. Median/p95 can hide a few severe stalls. Warmup may be insufficient after changing shaders: a preparing pipeline is inconclusive, so rerun only after it settles. Quick evidence finds large improvements; it does not certify small differences or release targets.

For final acceptance, omit `--quick`: warm for five seconds and collect 180 intervals, with a ten-second sampling limit. Insufficient intervals, lost focus/visibility, or changing scene/viewport invalidate acceptance. This bounds even a stalled run instead of waiting minutes for a fixed frame count. Timeouts can still wait for a blocked main thread to return; wall-clock sample limits cannot interrupt JavaScript or the GPU driver. Scene readiness is separate from sampling and may take up to 20 seconds.

`--viewport 1470x738 --dpr 2` explicitly requests 2940×1476 physical output. The profiler uses one owned CDP connection so automation cannot silently reset DPR during the sample; it records start/end viewport, actual buffers, settings, adapter and cache/source identity. These overrides emulate density in Chromium, not Safari hardware acceptance. Reports live beside area/revision evidence as `performance-quick.json` or `performance.json`; quick runs never overwrite acceptance evidence. No new browser or scene reload is needed when the current area matches. Compare one affected setting at a time. Read the renderer canvas `data-graphics` JSON for frame intervals, settings, dimensions and FSR compute timings. FSR timings exclude scene rendering, later effects; they do not measure whole-frame GPU cost. Save raw samples and private captures under `.local/`; never publish licensed-art captures as part of a source update.

Compare the same machine, runtime, scene and settings. Repeat only the affected case when noise makes the result inconclusive; report variation. Frame intervals measure presentation cadence, not isolated GPU execution or headroom beyond vsync. Do not compare virtual CI rendering with desktop GPU measurements.

The current clearing has Graphics and Sound Options and a version-pinned r186 FSR Temporal adapter. The older art/renderer comparison URLs now lead to this same clearing. The animation comparison remains separate. Settings defaults live in the source owner, not in historical tables.

## Unresolved validation limits

Safari cold-start variability, native-output frame targets and target-platform acceptance remain unresolved. Safari world entry has exceeded the host memory limit; the current investigation and retained evidence are owned by the friction log. Smaller-viewport Chromium samples and warmed reloads do not establish foreground Safari acceptance. Prepared lighting and local checks do not establish 60 fps, release readiness or cross-platform performance. Investigate current failures against [.agents/FRICTION_LOG.md](../.agents/FRICTION_LOG.md); perform measurements only for an explicit request or evidenced defect.

## Browser startup memory work — October 5, 2026

The Safari memory termination defect authorizes this focused investigation. Implementation is in the private `browser-memory-safe` task; target-platform acceptance remains open. Sources and licensed captures stay private. Preparation selects 49 validated runtime derivatives, including B1, with the recipe and lossless exceptions in [asset preparation](ASSET_PREPARATION.md#memory-safe-runtime-derivatives).

Matched Chromium Homestead entry at 1920×1080 CSS/physical pixels, DPR 1, FSR Quality (1280×720 internal), High shadows/particles, sharpening 0.5, exposure 1.25, warmth 0.85, fog 0.7, bloom 0.25, AO off, soft DOF and texture depth off created 1,375,364,038 estimated GPU texture bytes versus 4,366,946,114 in the investigation baseline: 68.5% less. These are cumulative creation estimates, not Safari peak resident GPU or process memory. Application resources were reloaded on the isolated owned origin; OS/driver shader caches were not cleared. Runs used Chromium 152 on the target Mac, rather than foreground Safari. Folder relocation caused development reloads; interrupted runs are excluded. Loading variation and browser visibility prevent treating these measurements as Safari acceptance.

| Acceptance target | Recorded result | Status |
| --- | --- | --- |
| Safari entry without reload/device loss | Implementation flow not exercised; computer control still reported a locked Mac after unlock confirmation and reconnect | Pending |
| Safari process peak ≤4 GiB, settled ≤3 GiB | No accepted implementation process-footprint measurement | Pending |
| First-entry texture creation ≥60% lower | 68.5% lower in matched Chromium trace | Chromium target met |
| Equivalent texture views share storage | Focused two-GLTF ownership, UV-transform and color/data fixtures pass | Fixture proof; Safari pending |
| Native compilations ≤4 active | Observed queue peak 4 | Chromium target met |
| Shader preparation ≤1 active | Observed builder queue peak 1 | Chromium target met |
| Image decode/transcode ≤2 active | Observed queue peak 2 | Chromium target met |
| Transfers ≤4 and GLTF parses ≤1 | Observed peaks 4 and 1 | Chromium target met |
| Transient image admission 128 MiB | Queue reservations configured at 128 MiB; oversized-alone fixture passes | Admission proof; measured transient peak pending |
| Shared inactive art ≤512 MiB | First-entry inactive estimate 47,985,832 bytes; repeated travel plateau not measured | First-entry target met; circuit pending |
| Fresh entry ≤10 seconds | Recorded entries varied 11–25 seconds; final resource-cached Continue 10.281 seconds | Unmet |
| Cached entry/travel ≤3 seconds | Final resource-cached Continue 10.281 seconds; travel acceptance not completed | Unmet/pending |
| Safari three fresh, three cached, two four-area circuits and interactions | Not completed | Pending |

Final entry ledger estimates 1,638,482,330 bytes of unique art storage: 790,487,678 GPU texture bytes, 667,248,848 transcoded mip bytes, 92,429,120 decoded image bytes, and geometry/motion/metadata. This excludes other rendering allocations and OS/browser overhead. Encoded-source retention settled at zero with a 39,911,963-byte recorded peak. Actual selected compressed material formats were ASTC 4×4, with explicitly lossless RGBA exceptions. Queue counters are numeric; diagnostics do not retain scenes or shader source strings.

The last sampled generation created 931 shader builders, including 610 single-target shadow builders and 310 physical beauty/MRT builders. This remains a substantial startup allocation path. Continue investigation with build identities, pass/light/geometry variants and retained node-builder data before changing fidelity, readiness or targets. Do not close the Safari friction entry from Chromium creation totals or static proof. The task checkpoint and bounded private evidence are retained under `.local/inspection/`; integration requires current native material proof, visual comparison and Safari acceptance. The final change-aware sanity check passed rendering policy, documentation, types, lint, prepared lighting, level/material references and material contracts, but failed the native-proof freshness gate after the latest shadow-template edit. The prior 19-check native probe passed before that edit. A fresh owned authoring preview remained in equipment preparation, so its proof could not be refreshed during wrap-up. The final focused ownership/readiness run passed 18 tests. The previously completed production build passed; final edits have not established a new production/native proof.
