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

## Combat, water and loot CPU work — October 2, 2026

The combat coordinator reuses its timing records instead of rebuilding five objects and a closure on every frame. Each query refreshes all three actors' durations, contacts and commitment lead plus prepared ability timings; simulation consumes the records synchronously and snapshots accepted attacks. Weapon swaps and replacement motions therefore remain visible on the next query.

Water reuses the existing wave terms along each axis of its unchanged 33 × 25 vertex grid. `src/rendering/water-waves.ts` keeps intermediate results in double precision and writes the same position/normal attributes as before; foam still shares the position buffer. This reduces trigonometric evaluations from 3,300 to 116 per surface update and replaces a 9,900-byte original-position copy with 1,160 bytes of coordinate and wave arrays. A focused local comparison found byte-identical position and normal buffers across 55 dimension/time cases, including repeated times. Materials, topology, timing and GPU buffers are unchanged. Current authored areas contain no water, so this improvement applies when the supported water effect is used.

Loot picking now checks cached expanded world bounds before querying model triangles. Exact triangle hits retain priority over thin-item click tolerance; landing transforms, parent transforms and prepared-model replacement still invalidate bounds. A focused comparison of 2,625 queries matched the preceding selection behavior across landing poses, overlapping items, transformed parents, membership removal and model replacement. The grid queries submitted 629 candidate roots instead of 78,120. These are correctness and operation-count observations, not frame-time or hardware benchmarks. Private comparison scripts/results remain under the task's `.local/` evidence.

## Static instances and interaction contours — October 2, 2026

The asset library detects skinned meshes once in each cached GLTF. Static models use the same ordinary hierarchy clone that SkeletonUtils starts with, avoiding its two node lookup maps and two subsequent hierarchy walks per instance. Skinned models retain skeleton cloning; assembly construction and shared geometry/material ownership remain unchanged.

Interaction contours refresh the selected target's ancestors and subtree once per frame instead of refreshing each outlined mesh's ancestor chain separately. Visibility checks, copied world matrices and world-width conversion remain unchanged. A private focused comparison matched static clone structure and shared resources, confirmed independent cloned skeletons, and matched 480 contour matrix/visibility/width results across parent motion and visibility changes. A normal-settings native WebGPU preview exercised hover and click interaction without browser errors. These checks establish behavior equivalence, not measured frame-time or RAM savings; evidence is retained in the resource-efficiency task archive.

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

## October 2 instance and animation storage

Removed meshes now release their r186 native render objects and per-object bindings. Area, equipment, drop, projectile and temporary lighting-capture cleanup retain shared geometry, materials and textures until their cache owner disposes them. Placeholder drop meshes also release bindings when prepared models replace them. This closes a retention path during repeated travel, equipment changes, loot collection and combat.

Animation profiles share immutable cached keyframe buffers with independent clip wrappers and action clocks. Masked shield actions select existing tracks; staff preparation copies only the tracks it edits. Loot labels sort only when membership changes, skip hidden projection and unchanged DOM writes, and keep the existing projection and collision layout. Interaction contours reuse their scale scratch vector.

Private comparisons against the preceding code matched every keyframe and sampled actor pose for axe-and-shield, bow and caster staff profiles. Label ordering and placement matched through hover, hide/show and membership changes; an unchanged label update produced zero DOM mutations. A prepared-art native WebGPU clearing review exercised Inventory and caster combat without runtime errors or missing art. Five retired caster bolts each released all three native disposal listeners. The focused level/resource tests passed. These are code and correctness checks; no benchmark, full local suite or measured FPS/process-memory claim accompanies this pass. Private comparisons and captures are retained under `.local/agent-archives/fidelity-resource-pass/level-design/parity/` after task cleanup.

## October 2 navigation and ambient frame work

Tree changes now construct one final worker navigation snapshot per microtask instead of constructing and retaining replacement arrays for every changed tree. Collision still commits immediately. Resource renewal skips all registered-node scans until the earliest pending regrowth deadline, retaining occupancy deferral and event order. Gameplay audio reuses footstep records, flame descriptors, its nearest-six array and loop-key set; flame distances are evaluated once per frame. Shadow fitting compares retained numeric camera/map state instead of constructing a serialized key every frame, with unchanged fitting formulas.

Private comparisons matched audio commands through movement, ties, pauses, reset and area replacement; harvest state/events through staggered deadlines, occupancy and registration; and exact shadow light/projection values through camera, zoom and map-size changes. The focused level checks also cover coalesced worker updates, stale replies and disposal before submission. One prepared-art native WebGPU clearing session confirmed movement, three chop contacts, tree felling, 30 collected Woodcutting XP and ready navigation, with no missing art or runtime/audio errors. Evidence is private under `.local/level-design/parity/runtime-performance/`. These are code-driven CPU/allocation improvements; no benchmark, full local suite or measured FPS/process-RAM gain is claimed.

## October 2 grass preparation and loot picking

Polygon boundary queries keep the existing arithmetic without allocating an edge-distance array. Grass coverage masks skip scenery without qualifying ground patches, matching the existing blade-generation filter. Equipment prepares one shared ability-timing snapshot after a successful replacement rather than rebuilding it every gameplay frame; swapping the active set retains the same combined timing values.

Loot synchronization uses a linear ID lookup, retains its picking roots and scratch storage, and caches tolerance bounds until the drop's world transform or prepared model changes. Triangle picking, nearest-hit ordering, the 10 cm tolerance and landing trajectories remain unchanged. Cached bounds and source references belong to the area presentation and are released with it.

Private comparisons against the preceding code matched Homestead's 40,000 blade records and both areas' 65,536-byte coverage masks exactly. Ability timings matched four equipment combinations. Loot transforms and selection matched through landing, removal, quantity changes, prepared-model replacement and parent movement. An unchanged five-drop tolerance query rebuilt zero bounds instead of five. A prepared-art native WebGPU Homestead review at the normal Balanced defaults confirmed movement, a completed axe attack and world-model hover/pickup of a dropped potion stack, with no runtime/audio errors or missing art. Evidence is private under `.local/level-design/parity/performance-audit.json` and `performance-audit-browser.json`, retained under `.local/agent-archives/runtime-performance-audit/level-design/parity/` after cleanup. These checks establish matching outputs and avoided work, without claiming measured FPS, GPU throughput or process-memory gains. No benchmark or full local suite was run.

## October 2 world interaction queries and joined motions

World interactions retain area-owned descriptors and query arrays while checking resource, chest, shelter and portal eligibility synchronously. Resource depletion queries return a boolean without allocating a state snapshot. Picking tests eligible object triangles first; a miss skips scenery raycasting, while a hit retains first-visible-surface occlusion and limits the occlusion query to the nearest visible target. Query scratch references clear after every pick, and area replacement releases the descriptors. Gathering regrowth checks reuse the player/enemy occupant records and positions.

Bow preparation caches the unchanged draw/release join by its source URL pair, sharing immutable synthesized keyframes with independent clip wrappers and action clocks. The prepared Paladin Bow join shares 108,004 bytes of keyframe arrays per additional concurrent profile; this is array storage, not measured process memory. The source-pair cache retains the first join for later equipment preparation.

Private comparisons matched 231 picking queries and seven eligibility states, including depletion/regrowth, restoration, portals, hidden ancestors and actor/scenery occlusion. A missed-target probe invoked no scenery raycast, versus one previously. All Bow keyframes and sampled interpolations matched the preceding implementation, and gathering occupancy matched across movement, enemy defeats and area changes. Evidence is under `.local/level-design/parity/frame-resource-savings/`, retained under `.local/agent-archives/frame-resource-savings/level-design/parity/` after cleanup. The light sanity gate passed. Native gameplay review remains unverified because another task held the single GPU-review lease; the owned queued request was cancelled without disturbing that session. Rendering settings, shader formulas, effect counts and motion synthesis are unchanged. No benchmark or full local suite was run, and no FPS, GPU-throughput or process-memory improvement is claimed.


## October 2 redundant presentation work

The DOF input color copy omits its unused depth attachment; the effect still reads the same scene-depth guide. Particle emitters transform their position only when their unchanged carry clock emits at least one particle. Area presentation updates only trees with an active hit reaction, restoring the authored rotation before retiring that reaction; felling and regrowth also cancel it. Enemy health bars skip projection while ineligible, read viewport dimensions once when needed and avoid unchanged visibility/position writes. Rendering settings, shader formulas, emission counts and motion timing are unchanged.

Focused private comparisons against the preceding code matched particle buffers across 80 updates, tree visibility/world transforms across 60 updates and enemy-bar visibility/placement across 18 updates. The fixtures included moving emitter parents, pauses, hidden emitters, quality/atmosphere changes, repeated tree hits, felling/regrowth, bar expiry, resizing and occlusion. They observed 35 emitter transforms versus 142, 88 tree rotation writes versus 246, zero idle enemy-bar projections versus two and zero unchanged bar writes versus four. These are avoided-work counts in small correctness fixtures, not timing or hardware benchmarks. Evidence is private under `.local/level-design/parity/runtime-efficiency/`, retained under `.local/agent-archives/runtime-efficiency/level-design/parity/` after cleanup. Native gameplay review remains unverified because another task held the GPU-review lease; the verified owned queued preview was cancelled. No full local suite or measured FPS/process-memory improvement is claimed.

## October 2 loot layout and presentation lookups

Loot labels retain one layout record per live label and reuse the visible-row array. Projection, current DOM dimensions, sorted collision placement and batched style writes remain unchanged; removal and disposal release retained records. Projectile presentation builds one reusable ID set per synchronization instead of repeatedly scanning simulation projectiles for each displayed object. Interaction highlights decompose the already refreshed world matrix rather than calling a scale getter that refreshes the same ancestor chain again, preserving signed scale handling.

Focused private comparisons matched label output across 100 updates, projectile transforms/removal across 80 updates and highlight matrices/width/visibility across 80 updates. Cases included crowded labels, narrow/resized viewports, changing text dimensions, hidden labels, membership changes, moving parents and reflected scales. Highlight ancestor refreshes fell from 640 to 320 in that fixture. Evidence lives under `.local/resource-parity/` and is retained in the task archive after cleanup. These are correctness comparisons and avoided-work observations, not measured CPU time, GPU throughput or process-memory savings. Rendering settings, shaders, geometry and motion timing are unchanged; no benchmark or full local suite was run.

## October 2 LOD and idle simulation allocations

LOD bounds retain their per-root matrix, group records and centre vectors instead of replacing them whenever an animated assembly refreshes. Synchronous queries reuse box/size scratch storage; animated bounds still refresh on every call, and static bounds retain their transform invalidation. Orthographic LOD selection skips the camera world-position query because its unchanged threshold formula uses only view height and zoom.

Exploration uses shared read-only default timing records when prepared timings are absent, and skips projectile filtering when there are no projectiles. Live projectile advancement, ordering and cleanup retain the preceding implementation. Pointer attack picking reuses its hit array, clearing references after each enemy query while preserving exact triangle selection and nearest-enemy ordering.

Private comparisons matched LOD visibility across 120 updates, pointer targeting across 140 queries and simulation state/events across 180 updates. Cases included animated child movement, transformed parents, both camera types, zoom, dead enemies, safe areas, pauses, bow projectiles and prepared/default timings. Orthographic LOD updates performed no camera-position query. Evidence is under `.local/resource-parity/`, retained in the task archive after cleanup. These are code and correctness observations; no benchmark, full local suite or measured CPU/GPU/process-memory gain is claimed.

Native gameplay review remains unverified: another task held the single GPU-review lease, so the identity-checked owned queued preview was cancelled without disturbing the active session. Rendering settings, LOD thresholds, art, shader formulas and motion timing are unchanged.

## October 2 audio lookup and locomotion allocations

Active named sounds have a direct key index instead of scanning every voice for ambient-loop updates and attack cancellation. Stopping or ending a voice releases the index entry; a fading voice cannot remove a newer replacement with the same key. Empty-key behavior, voice caps, source ordering, attenuation, fades and playback scheduling retain their preceding behavior. The index references existing active voices and retains no additional decoded buffers.

Actor locomotion uses fixed directional-role lists and indexed loops, avoiding two per-update callbacks, repeated lower-body role strings and temporary role arrays at locomotion startup. Stride arithmetic, directional order, gait phases and action weights are unchanged.

A private comparison matched all 180 actor-update snapshots and 11 audio lifecycle snapshots against the preceding code, including paused/zero-time updates, blocking blends, missing directional clips, action transitions, loop movement, key reuse before a fading voice ends, natural completion, empty keys, voice limits and disposal. Evidence lives under `.local/resource-parity/compare.mjs` and is retained in the task archive after cleanup. These are correctness checks, not measured CPU time or process-memory savings. Native gameplay review remains unverified because another task occupied the GPU-review lease; only this task's identity-checked queued preview was cancelled. No benchmark or full local suite was run. Art, shaders, rendering settings and animation timing are unchanged.

## October 2 grass buffers and pointer camera snapshots

Grass carpet cells share their immutable blade position, normal, height and index attributes within one area, saving 516 bytes of typed-array storage per additional cell and avoiding duplicate native buffers. Instance attributes, cell bounds, blade count, materials and wind formulas are unchanged. The carpet removes its entire root before disposing cell geometry, so no remaining cell borrows a retired buffer. Area preparation computes blade normals once and fills instance arrays directly, avoiding four temporary arrays and two bounds vectors per blade.

Pointer aiming snapshots the four displayed camera matrices consumed by ray generation and sprite picking rather than copying the complete camera object each frame. The snapshot stays independent of subsequent camera movement and temporal jitter; view offsets and zoom remain encoded in the copied projection matrices.

A private comparison matched all grass attributes byte for byte and matched cell positions, instance counts and bounds in a 12-cell fixture, reducing distinct attribute/index storage from 17,952 to 12,276 bytes. It also matched 180 pointer rays and ground/sprite picks across movement, zoom, view offsets and subsequent live-camera mutation. Evidence lives under `.local/resource-parity/`, retained in the task archive after cleanup. These are correctness and allocation observations, not measured frame-time or process-memory gains. After GPU admission became available, one owned normal-settings native WebGPU preview rendered the authored scene, accepted movement and zoom, and showed the pointer cursor over a gatherable object before a click. The browser reported no errors. This short interaction check does not establish pixel parity or cross-platform performance. No benchmark or full local suite was run.

## October 2 live particle slots and pursuit waypoints

Particle pools retain a fixed `Uint16Array` of live slot indices. Updates visit only live particles, removing expired indices by swapping the last live entry into the gap. Spawning into an occupied ring slot does not add a duplicate; quality changes compact survivors, and atmosphere/area resets discard the live list. GPU slot order, draw ranges, emission/random calls, motion formulas and uploads remain unchanged. The seven pools add 3,456 bytes of fixed CPU storage to avoid scanning unused slots.

Enemy pursuit advances a cursor through reached waypoints rather than shifting the remaining path array. Route refresh reuses its two-coordinate target record and resets the cursor. Navigation queries, refresh cadence, waypoint reach distances and movement decisions remain unchanged.

A private comparison matched all particle buffers byte for byte across 650 updates, including ring overwrites, expiry, quality/atmosphere/weather changes, pauses, hidden emitters and area resets. Another 300 queries through real navcat/Rapier adapters returned identical pursuit directions across movement, target changes and route resets. Evidence lives under `.local/resource-parity/` and is retained in the task archive after cleanup. These are correctness checks, not timing or hardware benchmarks; no measured frame-time or process-memory improvement is claimed.


## October 2 particle uploads and bounded ambience selection

Particle pools retain one merged update range per dynamic position/color attribute. Each update covers the smallest contiguous span containing its live and newly expired slots; resets and quality/atmosphere changes include all modified positions. Pending ranges merge until native WebGPU consumes them, including skipped renders and hidden pools. Particle buffers, slot order, emission, colors and motion formulas are unchanged. The pinned three.js native attribute uploader supports these ranges, including padded attribute layouts.

Flame ambience inserts into a reusable selection of at most six entries instead of sorting every authored flame. Distances are still computed once per flame, equal distances retain authored order, and loop identity/order, gains and scheduling are unchanged.

Private comparisons matched particle arrays and emulated native GPU uploads across 650 updates and audio calls across 560 cases. Cases included ring overwrites, expiry, quality/atmosphere/weather changes, pauses, area resets, hidden pools, skipped renders, tied distances, listener movement and audio reset. The particle fixture transferred 955,956 bytes instead of 9,404,928 bytes for its post-creation uploads. This is an operation-count observation, not a measured GPU-speed or process-memory improvement. Evidence lives under `.local/resource-parity/`, retained in the task archive after cleanup.

One owned normal-settings native WebGPU preview rendered Forest Clearing and accepted a canvas click and dodge input with no browser errors. The short inspection does not establish pixel parity or cross-platform performance. No benchmark or full local suite was run.

## October 2 loot matrices and motion validation

Loot presentation composes each drop root's local matrix only when the existing landing formulas produce changed position or rotation values. Settled loot avoids repeated Euler/quaternion writes and local matrix composition during rendering and picking. Parent world transforms remain automatic, and prepared-model replacement retains bounds invalidation. Enemy cast presentation iterates its owned entries without creating entry arrays each frame.

Motion installation deduplicates track-name parsing and rig-node validation within that installation. Validation still precedes action replacement and starts fresh for every installation; missing or malformed bindings retain their errors. Animation clips, keyframes, mixer actions and blend timing are unchanged.

A private comparison matched loot transforms, world matrices and picking across 90 updates, including landing, changed settled positions/heights, transformed/reflected parents and removal. Root matrix compositions fell from 2,258 to 134 in that fixture. Two repeated motion installations and a rejected missing-binding installation matched action/track snapshots and the error; instrumented parsing and node-search calls each fell from 793 to 91, including the mixer's own binding work. Evidence lives under `.local/resource-parity/`, retained in the task archive after cleanup. These are correctness and avoided-work observations, not measured frame-time or process-memory improvements. No benchmark or full local suite was run.

Native gameplay inspection remains unverified because another task held the shared GPU-review slot. The identity-checked owned queued preview was cancelled without disturbing that session. Rendering settings, geometry, materials, animation timing and landing formulas are unchanged; this pass does not claim pixel or cross-platform performance validation.
