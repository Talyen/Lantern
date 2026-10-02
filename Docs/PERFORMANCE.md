# Performance and renderer evidence

Ordinary feature work follows the [lean task workflow](DEVELOPMENT.md#working-alongside-other-agents): one relevant preview and fast sanity checks. Benchmarking and the matched protocol below require a specific user request or an evidenced performance defect. Routine feature work, audits, release-readiness gates and scheduled automation must not benchmark. Managed scripts queue one heavy operation, one check job and one agent GPU inspection while leaving the user's play session alone.


Use matched local measurements to judge changes; performance numbers are advisory, not CI gates. Browser resource smoke does not execute the renderer.

## October 1 isolated task workflow

The two real private tasks initially took 18.14 and 18.53 seconds to prepare on the local Apple M5 / 16 GB APFS Mac, including checkout, two prepared-art snapshots, dependency cloning and asset indexing. These are setup observations, not an estimate of physical storage allocated by clones.

One warmed clone of the same dependency directory (4,983 entries) took 0.877 seconds before and 0.469 seconds after the native helper optimization. The helper now loads `clonefile` once, traverses with `scandir`, creates parent directories once and lets per-file `clonefile` preserve attributes. Editing a cloned package file preserved the source bytes and used a different inode; the relative executable link still resolved inside the clone. No directory cloning or large-copy fallback was introduced.

This single before/after sanity measurement includes Python startup and excludes deletion. It does not establish the full setup improvement, SSD write volume, GPU capacity or cross-machine performance. Asset indexing and other setup stages remain part of the total cost. Task status reports available disk, concise task/check evidence and live verified resource owners without dumping the asset catalog.

## Current rendering policy

Lantern requires native WebGPU across gameplay, authoring and labs through the shared graph. FSR Temporal is the sole reconstruction method (Balanced, sharpening 0.50 by default), with output pixel ratio fixed at 1. There is no reconstruction fallback; WebGPU/FSR startup failure produces an actionable error. Independent Shadow Quality and Particle Effects presets replace the overloaded quality setting. Atmosphere is simple profile distance fog; volumetric rendering is retired.

Archived studies and initial authoring measurements include evidence from before the native WebGPU-only migration. WebGL comparisons, retired lab controls and former TAA defaults are historical evidence. When measurements are requested or an evidenced performance defect warrants them, re-measure current authored areas and comparison labs on target hardware before drawing performance conclusions.

## Current measurement protocol

Run a fresh production build before measuring. Use hidden `npm run desktop:check -- --debug-port=9231` and attach CDP, or use a real browser. Keep GPU acceleration enabled. Record hardware, OS, browser/Electron and three.js versions, native WebGPU adapter, content viewport, scene/output dimensions, fixed output pixel ratio, FSR Resolution Quality and sharpening, graphics settings, camera, and asset set. Use [current graphics settings](GRAPHICS.md) for controls and temporary overrides.

Warm the chosen scene for five seconds, then sample at least 180 frames under the same motion/pause conditions. Read the renderer canvas `data-graphics` JSON for frame intervals, settings, dimensions and FSR compute timings. FSR timings exclude scene rendering, the reactive opaque pass and later effects; they do not measure whole-frame GPU cost. Save raw samples and private captures under `.local/`; never publish licensed-art captures as part of a source update.

Compare the same machine, runtime, scene and settings. Repeat only the affected case when noise makes the result inconclusive; report variation. Frame intervals measure presentation cadence, not isolated GPU execution or headroom beyond vsync. Do not compare virtual CI rendering with desktop GPU measurements.

The current clearing has Graphics and Sound Options and a version-pinned r186 FSR Temporal adapter. The older art/renderer comparison URLs now lead to this same clearing. The animation comparison remains separate. Settings defaults live in the source owner, not in historical tables below.

## Archived renderer studies

The [September 30 renderer studies](archive/RENDERER_STUDIES_2026-09-30.md) preserve the retired art lab, WebGL comparisons, r180 Options study and pre-migration temporal upscaling evidence. Their measurements, former defaults and fallback behavior describe those experiments, not current workflows.

## Level authoring measurements

See [level design](LEVEL_DESIGN.md) for the persistent visual loop. `npm run levels:measure -- --reason "request or defect evidence" --area=clearing` records a moving-gameplay sample after five seconds of warmup and at least 180 frames under ignored `.local/level-design/`. It uses the development authoring browser: treat it as iteration evidence and repeat release measurements with a fresh production build and GPU acceleration confirmed. The report records revision/hash, area definition, runtime, viewport/DPR, backend/settings, machine CPU/OS/memory and cadence samples. Browser GPU/driver identification and hardware acceleration need explicit inspection; CPU metadata alone does not establish the GPU.

Targets remain 60 fps on a named integrated-GPU baseline and scalable 120 fps on stronger hardware. Baseline hardware and cross-machine validation are outstanding. Use Unlimited for comparisons, report adapter identity and actual internal resolution, and do not infer 120 fps headroom from a 60 Hz presentation cadence. Warm authoring targets are <2 s edit-to-ready and <5 s per clean view; report cold startup separately.

### Initial authoring validation — September 30, 2026

On the local Apple M5 / 16 GB Mac, Chromium 152 at 1920×1080 and DPR 1, five warmed WebGL blockout data updates took 0.29–0.52 s end-to-end including automation and 16 settling frames; the area replacement itself reported 19–28 ms. Earlier WebGPU iterations also met the two-second target. The same canvas, target and overview zoom survived. Geometry/texture counts remained 40/48 across the five settled updates. Earlier WebGPU checks also showed stable render-target counts. Sixty animation-frame callbacks produced sixty rendered frames. Invalid spawn and JSON edits retained the preceding scene and recovered after repair; overlapping loads discarded stale requests. Keyboard travel worked in both directions without arrival bounce-back. Evidence is private under `.local/level-design/verification-webgl.json` and the session capture directories.

WebGL clean views took 0.36–0.64 s; the final WebGPU clearing batch took 0.55–0.98 s per view. Overview fits the full design envelope and apron using a development-only zoom range. The moving clearing sample with native TAA, High quality (`enhanced`) and Unlimited cap warmed five seconds then retained 180 frames: median 16.7 ms, p95 17.2 ms. Adapter identification reported Apple / metal-3 with `isFallbackAdapter:false`. These are local development-browser cadence measurements, not a 120 fps guarantee or a substitute for the production/target-hardware protocol above.

## September 30 native WebGPU-only migration (historical)

A local Chromium browser smoke pass with prepared art confirmed movement/camera follow, animation-delayed damage, victory, defeat, retry health/focus, Options reset and method changes, rock inspection, resize, saved FSR reload and clearing/blockout replacement. The comparison lab rendered both lanes through the shared graph with independent perspective cameras and histories; playback, clip selection, pause/step, view changes and resize passed. FSR, TAAU, TAA and Off compiled on the migrated routes.

Fault injection confirmed FSR → TAAU → TAA startup fallback with requested FSR retained, and an actionable startup error when all graph preparations failed. Suppressed WebGPU and a null adapter produced startup errors in both gameplay and the lab. Instrumented canvas creation recorded zero WebGL contexts throughout those checks, including legacy renderer/SMAA URLs. The native renderer bridges r186's otherwise swallowed asynchronous GPU compilation errors. Representative static guard probes rejected legacy renderers, shader hooks, context creation and extra graph owners.

This is local correctness evidence, not a fresh performance comparison or broad hardware certification. Browser flow evidence is private under `.local/webgpu-only-verification.json`; captures and fault-injection helpers remain private. The migrated lab uses two native renderer instances to isolate per-lane temporal state; measure that comparison's resource cost separately from gameplay.

## Gameplay library trials — September 30, 2026

Retained: original TSL weapon ribbon, navcat 0.4.1 route queries, Rapier 0.21.0 grounded collision, analytic gold/amber portal and one sparse rune decal. The published drei-vanilla Trail was inspected but its line material was not adopted. three-fluid-fx 0.1.0 was tested through its TSL entry point and removed after comparison: extra solver state did not produce a compelling improvement over the restrained analytic swirl.

Matched measurements used Apple M5 / 16 GB MacBook Air, native WebGPU Metal-3, headless Chrome 152, three.js 0.186.1, 1920×1080 output, DPR 1, High quality, FSR Temporal Quality, sharpening 0.2, AO 0.65, DOF 0.50 and bloom 0.40. The application FPS cap was disabled. The prepared clearing, fixed center camera, lighting and motion were identical: player away from enemy, repeating missed attack every two seconds. Each case warmed five seconds and then rendered at least 180 additional frames. Samples measure presentation intervals; display pacing limits conclusions about GPU headroom. These browser results are not Electron/Windows benchmarks.

| Case | Median / p95 (ms) | Reported GPU memory (bytes) |
| --- | --- | --- |
| Trail and portal off | 16.50 / 17.70 | 327619898 |
| Trail on, portal off | 16.60 / 17.60 | 327632602 |
| Analytic portal, trail off | 16.70 / 17.50 | 327776016 |
| Fluid portal, trail off | 16.70 / 17.60 | 328496098 |

The fluid case used 64-pixel velocity, 128-pixel density and six pressure iterations. The retained analytic portal avoids that extra compute work and approximately 0.7 MB of reported solver memory. Differences in cadence are within noise. The retained portal was subsequently moved to the rear of the clearing for clearer separation from foreground vegetation; no comparative speed claim relies on that placement change. Raw samples and licensed-art captures remain private under `.local/library-trials/`.

Navigation generation in the prepared clearing took approximately 34–36 ms in the browser. One generation occurs per area construction; routes refresh at most every 250 ms unless the target moves 40 cm. The focused movement flow covers blocked contacts, a route around a wall, sliding, a 20 cm step and a slope. Browser smoke covers movement, contact timing, visible trails, victory, defeat, retry and inspection pause. Windows hardware and a distributed Steam package remain unverified.

## Sculpted dusk verification

The following evidence describes the retired volumetric implementation and must not be used as a current performance baseline. Current fog uses no volume pass; shadow and particle presets now scale independently. Re-measure with fixed pixel ratio 1 and matched resolution quality on target hardware.

Private `.local/sculpted-dusk/` evidence records isolated lighting contributions, matched Golden/Silver zoom views, night variants, effective AA/movement/toggle/pause/travel checks, gameplay smoke and production measurements. Compare settled resource counts after warm-up. The concurrent grass pass owns the geometry-buffer correction and its separate evidence under `.local/grass-review/`; old leaking-instancing measurements are diagnostic evidence, not shipping performance. Local measurements do not certify Windows or a broader integrated-GPU baseline.

## October 1 FSR-only quality migration

Local headless Chromium with native WebGPU and prepared art verified fixed 1× canvas dimensions, Native and Balanced reconstruction, live Low/Medium/High shadows with flame shadows retained, independent particle presets, persistence/reload and Reset. Gameplay checks covered keyboard movement, delayed attack contact (100 → 50 after contact, then victory), defeat, Return Home at full health and rock inspection. Authoring and both comparison labs rendered without startup errors. Injected compilation failure rejected FSR preparation with an actionable error and no reconstruction fallback. Particle inspection confirmed 192/144/96 active slots and clearing outside reduced limits, retaining the 14-particle combat burst. These checks do not certify Windows hardware or comparative performance; the preceding grass-shadow investigation remains an independent finding.

## October 1 foliage and settings stabilization

Local hidden Chromium review used native WebGPU, prepared Homestead art, 1440×900 output, FSR Balanced and fixed pixel ratio 1. Off/Soft/Cinematic rendered; Golden/Silver and zoom 0.9/1.35/2 were inspected, with keyboard movement and reversals. Runtime sun depth coverage was 56 m in Homestead, replacing the previous 150 m span. Native PCF preserves scenery/actor shadows while grass receives without casting blades. DOF follows resolved FSR color with jitter-corrected bilateral depth; thin features at reduced scene resolution can still shimmer.

Warmed sharpening input handlers took 0–0.2 ms and reached the next animation frame in 13.8–17.6 ms, with no canvas resize or history reset. These are input-to-next-frame measurements, not display scanout latency. First-time effect-graph compilation/setup still produced approximately 304 ms main-thread tasks; the HTML UI has no worker isolation. Two retained effect graphs avoid repeated compilation for common DOF toggles, and Resolution Quality resizes existing buffers. Graph eviction releases pass-specific r186 render objects: repeated cache/eviction cycles held geometry, texture, target, program and uniform-buffer counts constant. Cached Homestead comparisons reported about 653 MB total native resources including private textures; the two-graph cache trades bounded memory for faster repeat changes. Counts/bytes are renderer diagnostics, not process-memory measurements.

Injected replacement failure retained the active graph and recovered on the next valid choice. Browser smoke passed movement, delayed hit progression, victory, defeat, return-home health/focus, Options and rock inspection. Both perspective animation-lab lanes rendered with Cinematic DOF; pause, frame step and view selection worked. Private evidence is under `.local/graphics-stability/`. This is local development correctness/responsiveness evidence, not a production GPU throughput comparison or Windows certification. The preceding FSR-only task had already removed volumetrics and mist pockets; this change preserves its simple profile fog.

## October 1 optional outlines

Outlines adds one RGBA16F attachment to the existing scene pass and contour sampling to the existing pre-FSR color composite; it adds no geometry pass. Logical attachment storage is eight bytes per scene pixel (about 5.47 MiB at the observed 1129×635 Balanced scene size for 1920×1080 output). Off omits the active attachment and processing; a recently used graph can remain in the existing two-appearance cache. Evaluate total presentation cadence and native resource counts with matched production On/Off views; FSR compute timings alone exclude this contour work.

Private review under `.local/outlines/` covers golden/silver and Moonlit/Deep night/Misty night, zoom extremes, native mask/depth occlusion, all four reconstruction qualities, DOF Off and sharpening 1. An initial maximum-of-directions edge combiner exposed diagonal crawl; the retained effect averages angular coverage before FSR. Continuous-motion and stationary probes include a thin weapon and an alpha-cutout occluder, with selected/unselected objects sharing a material. Settings save/reload and Reset passed in hidden native Chromium. Numerical pixel variation remains under high-contrast reduced-resolution stress; this is local visual evidence rather than an absolute no-aliasing guarantee or Windows/other-GPU certification. Keep matched timing samples, source hashes and asset-inventory fingerprints private alongside the review.

Measurements borrow the verified owned authoring preview's single GPU lease; there is no spare-slot reservation. The required `--reason` is validated before GPU admission or sampling and saved in the private report. Ordinary visual reviews use the same single slot. This prevents overlap between managed agent sessions, but does not establish exclusive hardware use while external applications or the user's play session are running. Record those conditions when interpreting results.

## Resource optimization pass

The retained runtime changes pause hidden/minimized play without catch-up time and stop drawing settled frozen/menu views. HTML animation stays independent; authoring `settle()` explicitly requests frames. A local native review observed identical frame counts during frozen, menu and hidden waits, unchanged hidden player state, and immediate drawing after menu close/resume. Active FPS preferences and graphics defaults are unchanged.

The graph omits unused beauty normals, writes only AO normals/depth, uses an R16F reactive mask and omits full-screen composite depth buffers. Source caches retain scene/bindpose data rather than GLTF parsers; active/loading scenery is leased and unused scenery has a 256 MiB warm budget. Bitmap closure follows final texture ownership. Static LOD bounds, light fitting and unchanged HUD writes avoid repeated CPU work.

An explicit UASTC KTX2 trial retained texture dimensions, mip chains and 16× filtering and showed lower per-device logical texture allocations. Process resident-memory/timing comparisons were not machine-isolated: agents in other projects were using GPU and memory. Those observations do not establish a compression-caused RAM regression or a reliable throughput improvement. The default art therefore uses lossless channel packing; compressed candidates and original inputs remain privately archived for a later controlled comparison.

Version-3 packing preserves authored color, normal RGB, roughness and metalness bytes and embeds height/cavity/eligibility in previously unused channels. It removes nineteen separate relief textures from staged runtime dependencies. PNG round-trip verification checks retained/copied pixels; native WebGPU upload/readback also preserves RGB under zero and partial alpha. The matched 1280×577 entrance view differed by at most 3/255 per channel (mean absolute difference 0.011/255), with no missing art or runtime errors. Its renderer resource estimate fell from 2,207,541,192 to 1,950,352,152 bytes (245.3 MiB); that estimate is not process RSS. Scene comparisons and raw resource counts are private under `.local/level-design/resources/`; cleanup retains them in `.local/agent-archives/resource-optimization/level-design/resources/`. These are local correctness and logical-storage observations, not a cross-platform performance or system-RAM claim. Further timing/RSS measurements are deferred until the whole-machine workload can be matched.

The production baseline additionally required eager core-rendering imports: a lazy chunk imported back into the still-awaiting gameplay module and stalled startup. Both baseline and candidate use that same bootstrap repair.

## October 2 frame-work optimization

This code-driven pass removes empty particle-pool scans/uploads/draws, shares identical water/foam wave positions, reuses actor/audio position storage, avoids voice-array copies, and skips unchanged action-bar DOM writes and closed inventory-grid refreshes. It retains rendering settings, shader formulas, live particle counts/trajectories, animation blending and audio scheduling. These changes reduce redundant work and allocation churn; no measured FPS or process-RAM improvement is claimed.

Private comparisons against the preceding implementations matched live particle buffers through emission, ring overwrites, expiration, quality changes, atmospheric toggles and pause/clear; water/foam vertices and normals also matched exactly. Actor gait, blend, action clocks/weights and sampled pose matched. Action-bar markup and audio voice-limit/scheduling comparisons passed, with zero DOM mutations for an unchanged action-bar update. One prepared-art native WebGPU clearing session confirmed movement, Inventory open/close and an animation-contact axe hit (enemy health 100 → 50), with no runtime or audio errors. No benchmark or full local suite was run; this is focused correctness evidence, not hardware performance certification.
