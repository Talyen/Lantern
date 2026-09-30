# Performance and renderer evidence

Use matched local measurements to judge changes; performance numbers are advisory, not CI gates. Browser resource smoke does not execute the renderer.

## Current measurement protocol

Run a fresh production build before measuring. Use hidden `npm run desktop:check -- --debug-port=9231` and attach CDP, or use a real browser. Keep GPU acceleration enabled. Record hardware, OS, browser/Electron and three.js versions, renderer backend, AA, content viewport, actual scene dimensions, DPR/render scale, graphics settings, camera, and asset set.

Warm the chosen scene for five seconds, then sample at least 180 frames under the same motion/pause conditions. Read the renderer canvas `data-graphics` JSON (median/p95 and settings) in the current Options implementation. Save raw samples and private captures under `.local/`; never publish licensed-art captures as part of a source update.

Compare the same machine, runtime, scene and settings. Repeat only the affected case when noise makes the result inconclusive; report variation. Frame intervals measure presentation cadence, not isolated GPU execution or headroom beyond vsync. Do not compare virtual CI rendering with desktop GPU measurements.

The current clearing has Graphics Options and a custom r180 temporal-AA adapter. The older art/renderer comparison URLs now lead to this same clearing. The animation comparison remains separate. Settings defaults live in the source owner, not in historical tables below.

## Historical studies — September 30, 2026

The following records preserve prior experiments. They predate the current Options UI and temporal rejection controls; old controls, sanctuary routes and defaults are historical, not current instructions. Existing raw evidence remains private. Windows and older integrated GPUs remain unverified.

## Art direction lab

Open **Explore art direction** from the clearing, or visit `/?lab=art`. The lab compares Blue-hour pines, Ashen ruins, Winter dusk, and the original renderer under the same geometry and camera. Switch between the playable clearing and a roofless Synty sanctuary. The sanctuary has its own idle character preview and pauses the clearing without changing its combat progress.

Surfaces are independent of lighting: choose the original palette, the existing painted rock/ground experiments, or the coordinated painterly stone/soil/wood set. Existing painted mode changes only the clearing; the sanctuary retains its original palette in that mode. Inspect rock freezes combat while viewing the selected surface. Pause stops combat, character motion, fire motion, and particles; camera zoom and art controls remain available. Save locally / Load saved store one custom look in this browser. Startup and Reset look use the chosen Ashen ruins direction: coordinated painterly surfaces, Enhanced quality, Atmosphere 0.70, Bloom 0.80, AO 1.00, and DOF 1.00 (exposure 1.10, warm/cold balance 0.85). The playable clearing uses the same chosen rendering by default.

The lab uses `postprocessing` 6.39.5 with the existing WebGL renderer: half-float HDR buffers, optional normal-buffer SSAO and orthographic depth of field, thresholded bloom, merged exposure/desaturation/vignette and ACES tone mapping, and selectable FXAA, SMAA High, or 4× MSAA. Tone mapping runs once; output is converted to sRGB once. The original rendering baseline bypasses the composer and restores the original lights, fog, and exposure, keeping the selected surfaces. Ambient fog and sparse procedural mist/embers/snow accompany the three moods. Supporting braziers provide amber point lights. Refined lighting adds one softened shadow-casting spotlight per space, gentle intensity flicker, and subtle non-shadowing character fill. The clearing also retains directional shadows with tighter coverage; the sanctuary disables directional shadows.

Laptop quality caps pixel ratio at 1, reduces bloom luminance/blur resolution to 35%, uses 55 particles, and initially disables AO and bokeh. Enhanced caps pixel ratio at 1.5, uses 50% bloom resolution and 180 particles, and enables restrained AO and bokeh. Both expensive effects can be adjusted independently in either mode. DOF tracks the camera's focus target with a broad 16-world-unit focus transition so combat remains readable. The animation lab retains its existing renderer. The normal clearing shares the chosen art pipeline without the comparison controls. Temporal AA on WebGPU is now the preferred default; the WebGL pipeline remains available as an alternative and falls back to SMAA when native WebGPU is unavailable.

### Original surfaces and local export

The original text-generated surfaces are `assets/textures/stone-painterly.png`, `soil-painterly.png`, and `wood-painterly.png`. They share broad painted shapes and restrained variation, with no baked directional lighting. No Synty source, texture, or render was submitted to ImageGen. The bake projects each surface locally and exports 1024px color textures; characters and foliage retain their palette materials.

```sh
npm run assets:export-art-lab
# Optional: --topaz /absolute/path/to/Topaz --blender /path/to/blender
```

The exporter reads seven Synty models (including the existing rock) from Topaz and creates original/painterly variants under ignored `public/vendor/synty/art-lab/`. Ground is baked to ignored `public/vendor/terrain/ground-painterly.glb`. UV previews stay in ignored `.local/art-lab/`. Missing experiments are reported and available original meshes remain visible. Licensed models, bakes, and comparison captures remain local; the existing deployment packaging boundary still applies.

### First comparison, September 30, 2026

The first comparison recommended **Blue-hour pines with painterly surfaces and restrained bloom**. The subsequent chosen direction is **Ashen ruins with Enhanced quality**, stronger atmosphere (0.70), bloom (0.80), AO (1.00), and DOF (1.00). Its cool stone and evergreen contrast with the warm soil and amber refuges. Ashen ruins is a useful darker interior variant; Winter dusk is the more open, readable weather variant. Keep AO and bokeh optional while refining the scene. The dock-floor study deliberately retains its timber joints; wood has clearer projection direction changes on perpendicular faces and is worth refining before expanding to more architecture. The new rock is less bright than the existing painted experiment. No obvious UV cracks were observed in the browser rock inspection, but these are surface studies rather than final texture approval.

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


## Renderer and desktop comparison

The game, art lab, and `/?lab=renderers` now default to **WebGPU temporal reprojection AA**, preserving Ashen ruins and its chosen Atmosphere 0.70, Bloom 0.80, AO 1.00, and DOF 1.00. The edge-quality selector keeps FXAA, SMAA High, and 4× MSAA available through WebGL. Switching backend carries the selected look, surface, effect values, lighting, and space in the URL and restarts the encounter. The animation comparison lab keeps its separate existing renderer.

The WebGPU route shares scene construction, geometry, skeletal animation, lighting, and camera behavior with the WebGL game. Its TSL pipeline provides contact AO, temporal resolve, orthographic DOF, thresholded bloom, grading/vignette, ACES, and one sRGB conversion. AO and blur use different algorithms from the WebGL library, so the matched controls reproduce the treatment rather than pixel-identical output. The r180 integration explicitly converts orthographic depth and initializes previous-bone data on cloned skeletons. Retry, inspection changes, space switches, and viewport changes rebuild or resize temporal history.

**Inspect edges · lens off** temporarily removes AO, bloom, and DOF without overwriting the chosen settings; restore them with the same button. **Lighting** compares the refined fire shadows/fill against the original light contributions. The comparison route fixes pixel ratio at 1 to avoid resolution differences between AA methods. Native WebGPU unavailability is reported and falls back to WebGL SMAA. DLSS, vendor temporal upscalers, and Steam SDK integration remain deferred.

### Local Electron shell

```sh
npm run desktop                         # build, then open a playable comparison window
npm run desktop -- --aa=smaa            # WebGL alternative
npm run desktop:run                     # open the existing build
npm run desktop:check -- --debug-port=9231  # hidden background checks against the existing build
```

Electron 44.5.1 serves the private build only on an ephemeral loopback port, with sandboxing and context isolation enabled and Node integration disabled. Public deployment is not configured. The visible window is centered and fits within 90% of the current display's work area, capped at 1280×900. On this MacBook Air that produced a 1280×745 outer window inside a 1470×828 work area.

Automated runs use **desktop:check**: the window stays hidden, is non-focusable, and does not focus on navigation. On macOS the app uses accessory activation policy and hides its Dock entry. Background throttling is disabled so rendering checks continue while hidden. The verification run reported `visible:false` and `focused:false`. Use the visible desktop commands only when explicitly reviewing or playing the app; automated checks must use background mode.

### Matched results on the M5

Captured in Electron 44.5.1 on this MacBook Air M5 with device pixel ratio 1. CDP set 1920×1080 and 2560×1440 content viewports for matching render loads; the control panel occupies 350px, leaving 1570×1080 and 2210×1440 scene buffers. Each case warmed for five seconds, then recorded recent frame intervals while characters and fire animated. Both clearing and sanctuary were checked; the table reports the slower space for each mode. These are vsync-limited frame intervals, not isolated GPU timings.

| Mode | 1080p median / p95 | 1440p median / p95 |
| --- | --- | --- |
| WebGL FXAA | 16.7 / 17.9 ms | 16.7 / 17.7 ms |
| WebGL SMAA High | 16.7 / 17.7 ms | 16.8 / 18.1 ms |
| WebGL 4× MSAA | 16.7 / 18.1 ms | 19.2 / 21.9 ms |
| WebGPU temporal AA | 16.7 / 17.7 ms | 16.7 / 18.6 ms |

Temporal AA met approximately 60 fps here at both tested sizes and is the selected default based on visual preference. Its softer reconstruction fits the selected atmosphere; SMAA is a useful sharper alternative. 4× MSAA dropped to approximately 52 fps in the 1440p clearing. Keep Windows validation as a release gate: these macOS measurements do not establish Windows driver behavior or performance on older integrated GPUs.

Private captures, the matched comparison sheet, lens-free captures, and raw timing samples stay under ignored `.local/renderer-pass/`. Windows validation is outstanding. No new automated test infrastructure, asset exports, vendor upscalers, or public uploads were introduced by this pass.


### Camera stability and TAA tuning

Camera follow now eases only the focus point and keeps the isometric offset fixed at (12, 12.5, 12). The previous independent camera/target easing changed the viewing angle and distance during movement. Initial camera placement uses the same offset to avoid a jump when movement starts. Temporal AA still uses its required subpixel sampling offsets; there is no intentional gameplay shake.

Characters are part of the same color/depth/velocity pass as scenery, including skeletal motion history. TAA resolves before DOF and bloom. Thin moving features, low render resolution, and edges introduced by later effects can still look aliased. Inspect edges disables the lens effects to isolate the temporal resolve.

The installed three.js r180 TRAA implementation hardcodes its sampling pattern and a base 95% history weight. Current upstream documentation describes additional depth/motion rejection controls, but those are not present in this installed version. Exposing those controls requires a deliberate renderer upgrade or a maintained temporal wrapper. A higher render resolution is another way to improve small character silhouettes.

TAA can be combined with a subsequent SMAA or FXAA cleanup stage, at additional cost and potential softness. Such stacked modes are not currently implemented by the selector. The current TRAA node explicitly requires MSAA to be disabled; its depth/velocity inputs cannot simply be changed to multisampled buffers.
