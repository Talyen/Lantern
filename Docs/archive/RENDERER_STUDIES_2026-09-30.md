# Archived renderer studies — September 30, 2026

Current rendering policy and measurement instructions live in [Performance](../PERFORMANCE.md).

## Historical studies — September 30, 2026

The following records preserve successive experiments before the native WebGPU-only migration, including retired lab controls, earlier Options behavior and former defaults. They describe the implementation at each study, not current instructions. Existing raw evidence remains private. Windows and older integrated GPUs remain unverified.

### Art direction lab

The retired **Explore art direction** menu and `/?lab=art` route compared Blue-hour pines, Ashen ruins, Winter dusk, and the original renderer under the same geometry and camera. Players could switch between the playable clearing and a roofless Synty sanctuary. The sanctuary had its own idle character preview and paused the clearing without changing its combat progress.

Surfaces were independent of lighting: choices included the original palette, the painted rock/ground experiments, and the coordinated painterly stone/soil/wood set. Painted mode changed only the clearing; the sanctuary retained its original palette in that mode. Inspect rock froze combat while viewing the selected surface. Pause stopped combat, character motion, fire motion, and particles; camera zoom and art controls remained available. Save locally / Load saved stored one custom look in the browser. Startup and Reset look used the chosen Ashen ruins direction: coordinated painterly surfaces, Enhanced quality, Atmosphere 0.70, Bloom 0.80, AO 1.00, and DOF 1.00 (exposure 1.10, warm/cold balance 0.85). The playable clearing used the same chosen rendering by default.

The lab used `postprocessing` 6.39.5 with the then-existing WebGL renderer: half-float HDR buffers, optional normal-buffer SSAO and orthographic depth of field, thresholded bloom, merged exposure/desaturation/vignette and ACES tone mapping, and selectable FXAA, SMAA High, or 4× MSAA. Tone mapping ran once; output was converted to sRGB once. The original rendering baseline bypassed the composer and restored the original lights, fog, and exposure, keeping the selected surfaces. Ambient fog and sparse procedural mist/embers/snow accompanied the three moods. Supporting braziers provided amber point lights. Refined lighting added one softened shadow-casting spotlight per space, gentle intensity flicker, and subtle non-shadowing character fill. The clearing also retained directional shadows with tighter coverage; the sanctuary disabled directional shadows.

Laptop quality capped pixel ratio at 1, reduced bloom luminance/blur resolution to 35%, used 55 particles, and initially disabled AO and bokeh. Enhanced capped pixel ratio at 1.5, used 50% bloom resolution and 180 particles, and enabled restrained AO and bokeh. Both expensive effects could be adjusted independently in either mode. DOF tracked the camera's focus target with a broad 16-world-unit focus transition to keep combat readable. The animation lab retained its separate renderer. The normal clearing shared the chosen art pipeline without the comparison controls. A subsequent comparison selected WebGPU temporal AA as its default while retaining WebGL and SMAA fallback; that backend fallback has since been removed.

#### Original surfaces and local export

At the time of this study, the original text-generated surfaces were `assets/archive/textures/stone-painterly.png`, `soil-painterly.png`, and `wood-painterly.png`. They share broad painted shapes and restrained variation, with no baked directional lighting. No Synty source, texture, or render was submitted to ImageGen. The bake projects each surface locally and exports 1024px color textures; characters and foliage retain their palette materials.

Current retained scenery preparation is documented in the [optional scenery and surface workflow](../ASSET_PREPARATION.md#optional-scenery-and-surface-studies).

The exporter reads seven Synty models (including the existing rock) from the private local library and creates original/painterly variants under ignored `public/vendor/synty/art-lab/`. Ground is baked to ignored `public/vendor/terrain/ground-painterly.glb`. UV previews stay in ignored `.local/art-lab/`. Missing experiments are reported and available original meshes remain visible. Licensed models, bakes, and comparison captures remain local; the existing deployment packaging boundary still applies.

#### First comparison, September 30, 2026

The first comparison recommended **Blue-hour pines with painterly surfaces and restrained bloom**. The subsequent chosen direction was **Ashen ruins with Enhanced quality**, stronger atmosphere (0.70), bloom (0.80), AO (1.00), and DOF (1.00). Its cool stone and evergreen contrast with the warm soil and amber refuges. Ashen ruins is a useful darker interior variant; Winter dusk is the more open, readable weather variant. The study recommended keeping AO and bokeh optional while refining the scene. The dock-floor study deliberately retains its timber joints; wood has clearer projection direction changes on perpendicular faces and is worth refining before expanding to more architecture. The new rock is less bright than the existing painted experiment. No obvious UV cracks were observed in the browser rock inspection, but these are surface studies rather than final texture approval.

Browser verification covered movement, animation-timed damage, victory, defeat, retry, rock inspection, preset/surface changes, saved-look restoration, pause/resume, and sanctuary switching. Comparison captures and raw samples live in ignored `.local/art-lab/` (`comparison-sheet.png`, individual clearing/interior captures, `comparisons.json`, and `measurements.json`).

Measured on a MacBook Air M5, 16 GB RAM, 8-core integrated GPU, Chromium 152 via ANGLE Metal. The browser viewport was 1920×1080; the scene was 1570×1080 because the controls occupy 350px. Device pixel ratio was 1. Each rendering mode warmed for five seconds before sampling its most recent 180 frames with motion paused for consistent comparisons. These initial measurements used Blue-hour pines (Atmosphere 0.35, Bloom 0.28), with Enhanced AO 0.35 and DOF 0.30; they predate the stronger chosen Ashen defaults.

| Rendering mode | Median frame interval | 95th percentile |
| --- | --- | --- |
| Original rendering baseline | 16.7 ms | 16.8 ms |
| Laptop | 16.7 ms | 16.8 ms |
| Enhanced (AO + DOF) | 16.7 ms | 16.9 ms |
| Laptop + AO only | 16.7 ms | 16.9 ms |
| Laptop + DOF only | 16.7 ms | 16.8 ms |
| Laptop, bloom off | 16.7 ms | 17.4 ms |

All six cases sustained approximately 60 fps here. These are presentation frame intervals, not isolated GPU timings; vsync prevents inferring GPU headroom or attributing small differences to individual effects. The three moods in both spaces also held approximately 60 fps (p95 ≤17.6 ms). Older Intel/AMD integrated graphics and Retina pixel ratios remain unverified; this result does not establish a universal laptop guarantee.


### Renderer and desktop comparison

At this stage, the game, art lab, and `/?lab=renderers` defaulted to **WebGPU temporal reprojection AA**, preserving Ashen ruins and its chosen Atmosphere 0.70, Bloom 0.80, AO 1.00, and DOF 1.00. The edge-quality selector kept FXAA, SMAA High, and 4× MSAA available through WebGL. Switching backend carried the selected look, surface, effect values, lighting, and space in the URL and restarted the encounter. The animation comparison lab kept its separate existing renderer.

The WebGPU route shared scene construction, geometry, skeletal animation, lighting, and camera behavior with the WebGL game. Its TSL pipeline provided contact AO, temporal resolve, orthographic DOF, thresholded bloom, grading/vignette, ACES, and one sRGB conversion. AO and blur used different algorithms from the WebGL library, so the matched controls reproduced the treatment rather than pixel-identical output. The r180 integration explicitly converted orthographic depth and initialized previous-bone data on cloned skeletons. Retry, inspection changes, space switches, and viewport changes rebuilt or resized temporal history.

The retired **Inspect edges · lens off** control temporarily removed AO, bloom, and DOF without overwriting the chosen settings; the same button restored them. **Lighting** compared the refined fire shadows/fill against the original light contributions. The comparison route fixed pixel ratio at 1 to avoid resolution differences between AA methods. Native WebGPU unavailability was reported and fell back to WebGL SMAA. DLSS, vendor temporal upscalers, and Steam SDK integration were deferred at this stage.

#### Local Electron shell

These measurements used the local Electron shell. Current launch and hidden-check commands are maintained in [Development](../DEVELOPMENT.md#commands-and-handoff); retired AA comparison arguments are no longer supported.

At this stage, Electron 44.5.1 served the private build on an ephemeral loopback port, with sandboxing and context isolation enabled and Node integration disabled. Public deployment was not configured. The visible window was centered and fit within 90% of the display's work area, capped at 1280×900. The current shell uses the secure local origin described in [Development](../GRAPHICS.md). On this MacBook Air that produced a 1280×745 outer window inside a 1470×828 work area.

Automated runs used **desktop:check**: the window stayed hidden, was non-focusable, and did not focus on navigation. On macOS the app used accessory activation policy and hid its Dock entry. Background throttling was disabled so rendering checks continued while hidden. The verification run reported `visible:false` and `focused:false`. Use the visible desktop commands only when explicitly reviewing or playing the app; automated checks must use background mode.

#### Matched results on the M5

Captured in Electron 44.5.1 on this MacBook Air M5 with device pixel ratio 1. CDP set 1920×1080 and 2560×1440 content viewports for matching render loads; the control panel occupies 350px, leaving 1570×1080 and 2210×1440 scene buffers. Each case warmed for five seconds, then recorded recent frame intervals while characters and fire animated. Both clearing and sanctuary were checked; the table reports the slower space for each mode. These are vsync-limited frame intervals, not isolated GPU timings.

| Mode | 1080p median / p95 | 1440p median / p95 |
| --- | --- | --- |
| WebGL FXAA | 16.7 / 17.9 ms | 16.7 / 17.7 ms |
| WebGL SMAA High | 16.7 / 17.7 ms | 16.8 / 18.1 ms |
| WebGL 4× MSAA | 16.7 / 18.1 ms | 19.2 / 21.9 ms |
| WebGPU temporal AA | 16.7 / 17.7 ms | 16.7 / 18.6 ms |

Temporal AA met approximately 60 fps here at both tested sizes and was selected as the default based on visual preference. Its softer reconstruction fit the selected atmosphere; SMAA was then considered a useful sharper alternative. 4× MSAA dropped to approximately 52 fps in the 1440p clearing. Keep Windows validation as a release gate: these macOS measurements do not establish Windows driver behavior or performance on older integrated GPUs.

Private captures, the matched comparison sheet, lens-free captures, and raw timing samples stay under ignored `.local/renderer-pass/`. Windows validation is outstanding. No new automated test infrastructure, asset exports, vendor upscalers, or public uploads were introduced by this pass.


#### Camera stability and TAA tuning

Camera follow at this stage eased only the focus point and kept the isometric offset fixed at (12, 12.5, 12). The previous independent camera/target easing changed the viewing angle and distance during movement. Initial camera placement used the same offset to avoid a jump when movement starts. Temporal AA used its required subpixel sampling offsets; there was no intentional gameplay shake.

Characters were part of the same color/depth/velocity pass as scenery, including skeletal motion history. TAA resolved before DOF and bloom. Thin moving features, low render resolution, and edges introduced by later effects can still look aliased. Inspect edges disabled the lens effects to isolate the temporal resolve.

The then-installed three.js r180 TRAA implementation hardcoded its sampling pattern and a base 95% history weight. Upstream documentation then described additional depth/motion rejection controls, but those were not present in the installed version. Exposing those controls required a deliberate renderer upgrade or a maintained temporal wrapper. A higher render resolution is another way to improve small character silhouettes.

TAA can be combined with a subsequent SMAA or FXAA cleanup stage, at additional cost and potential softness. Such stacked modes were not implemented by the selector. The r180 TRAA node explicitly required MSAA to be disabled; its depth/velocity inputs cannot simply be changed to multisampled buffers.


### Earlier clearing-only Options pass (r180)

At this stage, AA choices were TAA, SMAA, FXAA, and Off; MSAA and stacked-AA experiments were no longer runtime modes. Render scale was 75–125%. Measurements recorded the FPS limit and used Unlimited to avoid an application cap obscuring comparisons (display pacing still applied).

The earlier art/renderer menus and sanctuary had been removed from runtime. Diagnostics were on the renderer canvas's `data-graphics` JSON attribute; nothing was drawn over gameplay except combat state and Options.

The r180 temporal wrapper exposed history, motion and depth rejection. Projection sampling stayed fixed when camera position, rotation and zoom were stationary, and the sampling sequence resumed when the camera moved. This avoided the visible idle bounce without removing temporal history. Eight frozen-scene captures had zero frame difference and zero estimated translation after the fix. Sampling at rest no longer provided extra raster samples; higher render resolution could improve thin static details. That stationary sampling policy was replaced in the subsequent upscaling study. SMAA has since been removed.

Fire shadows and character fill were compared independently in frozen captures with lens effects disabled. The spotlight retained the same intensity while its cast-shadow flag changed; its shadow map was populated, and ground pixels changed. Fill affected the actors and nearby ground more subtly. Captures are under ignored `.local/options-pass/`.

Render resolution used ordinary filtered scaling. FSR 1 spatial upscaling or FidelityFX CAS were considered possible later TSL ports; neither was claimed by that selector. DLSS and modern vendor temporal upscalers were deferred at this stage.

### Temporal upscaling and ARPG camera — September 30, 2026

three.js is pinned to 0.186.1, types to 0.186.0, and `@pmndrs/upscaler` to 0.2.0. Native TAA was the default for this study. TAAU is the official three.js upscaler; FSR Temporal is an independent FSR2/3-style implementation with documented algorithm differences. Neither mode provides frame generation or official AMD FSR4. The FSR adapter changes only the r186 pipeline callback integration; its compute shaders remain package-owned.

This study changed the camera to look downward at 45 degrees with 45-degree azimuth (offset 12, 16.9705627485, 12), and default zoom is 1.45, up from 1.35. This is a steeper ARPG-style framing; no authoritative Diablo/Path of Exile numeric camera specification was established. Follow still translates only the focus point. Temporal upscalers jitter raster samples even with a stationary camera; this is subpixel sampling, not gameplay shake, and the projection offset is cleared after rendering.

Matched local measurements used an Apple M5 MacBook Air, macOS 27.0 (26A428), Electron 44.5.1, native WebGPU/Metal, DPR 1, High quality, and 1920×1080 or 2560×1440 output buffers. Cases warmed for five seconds after rendering became ready and sampled at least 180 rendered-frame intervals. The application cap was disabled; camera position stayed fixed while characters, foliage, water and fire animated. Same prepared clearing asset set and camera were used; procedural particles/grass were not frozen or seeded. Full-look settings were AO 0.65, DOF 0.50 and Bloom 0.40. Exposure 1.10, Firelight 0.85 and Atmosphere 0.70 stayed matched.

| Full look | 1080p median / p95 (ms) | 1440p median / p95 (ms) |
| --- | --- | --- |
| Native TAA | 16.7 / 17.6 | 18.4 / 20.2 |
| Filtered TAA, 67% | 16.7 / 17.6 | 16.7 / 17.4 |
| Filtered TAA, 50% | 16.7 / 17.6 | 16.7 / 17.4 |
| TAAU Quality | 16.7 / 17.6 | 16.7 / 17.7 |
| TAAU Performance | 16.7 / 17.6 | 16.7 / 17.7 |
| FSR Temporal Quality | 16.7 / 17.6 | 16.9 / 18.9 |
| FSR Temporal Performance | 16.7 / 17.6 | 16.7 / 17.6 |

With AO/DOF/bloom disabled, all seven modes at both output sizes measured median 16.7 ms and p95 17.3–17.8 ms. These results are vsync-limited presentation cadence, not whole-frame GPU timings. The initial native full-look 1440p sample exceeded the 60 Hz frame budget, but that slowdown was not reproduced in the final repeat below. These results do not establish a dependable upscaling speedup on this machine.

FSR exposed timestamp-query compute samples, but those exclude scene rendering, the additional opaque reactive pass, and later effects. Recorded values are recent pass samples, not averaged whole-frame costs. Other modes did not collect GPU timings. Do not compare those partial GPU numbers to presentation intervals or use them to rank full pipelines.

Private raw intervals, diagnostics, screenshots, r180 baseline, runtime metadata and verification scripts are under ignored `.local/upscaling/`. The r180 baseline used the previous camera and saved preferences, so it is historical context, not a matched before/after performance claim. Windows, Linux and other GPU families remain unverified. This study recommended retaining native TAA as default and trying TAAU Quality as the first optional lower-resolution mode, with FSR Temporal available for comparison. The later native WebGPU-only migration selected FSR Temporal as the fresh/reset default.

#### Final lifecycle repeat

After startup-preparation and history-reset integration, a fresh production build repeated the three primary modes at 2560×1440 with the same camera and full-look settings: native TAA 16.7/17.6 ms median/p95, TAAU Quality 16.7/17.6, and FSR Temporal Quality 16.7/18.0. The initial native slowdown varied with pipeline/runtime state or machine load; its cause was not isolated. Keep the original samples as evidence, but do not use their apparent advantage as a confirmed performance claim. Final samples are in `.local/upscaling/final-measurements.json`.

The table and frozen captures precede the concurrent level-builder migration; they describe the earlier clearing construction. Re-measure authored areas after that migration settles. After this integration, renderer history resets reused shaders; retry, inspection and resize passed with that lifecycle. A hidden Electron restart restored the saved rendering method, Balanced preset and zero sharpening.

#### Sampling stability and verification

Eight frozen-scene captures per WebGPU method at 1280×900, Quality upscaling, lens effects off, were compared over the scene excluding UI. Native TAA was pixel-identical. Mean absolute grayscale differences on the 0–255 scale were 0.410 for TAAU and 0.185 for FSR Temporal. Windowed phase-correlation estimates were at most 0.221 pixels for TAAU and 0.049 pixels for FSR. These are image-registration estimates, not camera-transform changes: small reconstruction shimmer remains possible, especially on thin details. FSR diagnostics confirmed changing subpixel sample offsets and the camera view offset cleared after each render. Do not disable temporal sampling merely to make these modes pixel-identical; native TAA remains the stationary baseline.

Movement, animation-delayed damage, victory, defeat, retry/focus, Options pause, rock inspection, and resize passed through representative flows in native TAA, TAAU, FSR Temporal and WebGL SMAA, without renderer errors. Graphics-method changes, all upscale presets, zero sharpening and saved-preference reload passed. Startup shader preparation is awaited, and the adapters retain setup errors because r186 otherwise logs them and substitutes a blank material. Renderer-internal access for that preparation and the native TAA adapter is version-pinned; revalidate it on future three.js upgrades.

Forced FSR compute-pipeline construction failure selected TAAU with the requested FSR preference retained; suppressing native WebGPU selected WebGL SMAA. The animation lab loaded 610 selector options after the dependency upgrade. Those injected fallback checks produced the expected fallback notices; normal rendering checks had no renderer errors.
