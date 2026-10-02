# Graphics settings

Options contains Graphics and Sound and pauses play while open. Escape opens/closes the menu. [Gameplay sound](AUDIO.md) owns sound controls and defaults; this page owns the graphics reference. Runtime defaults and parsing belong to `src/rendering/graphics-settings.ts`, with quality recipes in `src/rendering/quality-presets.ts`.

## Controls and defaults

| Control | Fresh/reset default | Choices or range |
| --- | --- | --- |
| Resolution Quality | Balanced | Native, Quality, Balanced, Performance |
| Sharpening | 0.50 | 0–1 |
| Shadow Quality | High | Low, Medium, High |
| Particle Effects | High | Low, Medium, High |
| Atmospheric particles | On | On / Off |
| Outlines | On | On / Off |
| Texture Depth | On | On / Off |
| Frame rate limit | 60 in browsers; display-based in Electron | 60, 120, 144, 240, Unlimited |
| Exposure | 1.25 | 0.5–2 |
| Firelight | 0.85 | 0–1 |
| Atmosphere | 0.70 | 0–1 |
| Bloom | 0.40 | 0–1 |
| Ambient occlusion | 0.65 | 0–1 |
| Depth of field | Cinematic | Off, Soft, Cinematic |

FSR Temporal is the sole reconstruction method. Output pixel ratio is always 1. Resolution Quality changes scene buffers without changing the window or display mode: Native uses 100% per axis, Quality uses 1/1.5, Balanced uses 1/1.7 and Performance uses 50%. Native WebGPU or FSR startup failure produces an actionable error; there is no renderer or reconstruction fallback. [Architecture](ARCHITECTURE.md#rendering-contract) owns this contract.

Shadow and particle quality are independent. Shadow quality changes map sizes while retaining authored light intensity and softness; fire shadows remain enabled. Particle Effects scales pool capacity, continuous emission and atmospheric density, preserving combat burst timing/counts. Atmospheric particles controls motes, smoke and embers, retaining flames, combat feedback, wind and water. Atmosphere adjusts preset distance fog; volume buffers, ray marching and bounded mist pockets are retired. Shared Golden lighting, local light recipes and explicit probe preparation belong to [Lighting](LIGHTING.md).

DOF follows reconstructed FSR output with a jitter-corrected bilateral depth guide and camera-target focus. Soft uses focus range 24 and bokeh 0.8; Cinematic uses 16 and 1.6. Off bypasses DOF. Invalid or old numeric DOF values use Cinematic. The character gallery uses the shared reconstruction defaults with AO 0.30, bloom 0 and DOF Off for inspection.

Outlines applies stronger warm-charcoal contours to actors/equipment and quieter contours to known solid props, excluding terrain, plants, scatter and effects. Contours run before FSR and stay inside visible surfaces, using existing depth/motion rejection. Their footprint targets 1.7 output pixels, with a one-scene-texel minimum and smooth coverage. Inspect a changed silhouette in motion at normal settings; thin weapons, alternate resolutions and occlusion probes are targeted diagnostics. The visual treatment belongs to [Art Direction](ART_DIRECTION.md#optional-outlines).

Material textures use fixed 16× anisotropic filtering and conservative FSR-aware mip sampling. Texture Depth adds shallow parallax to suitable prepared ground, rock and bark regions. Off skips height searches while retaining normal maps, spatial roughness, restrained cavity shading and physical geometry. Both choices persist; fresh/reset selects On. Material ownership and preparation follow [Architecture](ARCHITECTURE.md#rendering-contract) and [Art Direction](ART_DIRECTION.md#materials-and-projection).

## Frame pacing and camera

Electron supplies its initial display refresh rate. First launch/reset chooses the highest listed cap no higher than that rate, allowing 1 Hz for nominal rates such as 59.94; otherwise it uses 60. Saved caps take precedence. Unlimited removes the application cap but retains requestAnimationFrame display pacing. Simulation and animation include skipped callback time, with the existing 50 ms stall clamp.

The camera has a 35-degree downward pitch, 45-degree azimuth and default zoom 1.35; the wheel remains available. Existing area envelopes retain their saved dimensions. Camera ownership and follow behavior are documented in [Architecture](ARCHITECTURE.md#owners-and-data-flow).

## Temporary comparisons and persistence

Comparison URLs override settings for the current load without saving them through unrelated menu edits. Examples:

- `?upscaleQuality=quality&sharpness=0.2`
- `?upscaleQuality=performance`
- `?shadowQuality=low&particleQuality=low&atmosphericParticles=off&dof=off`
- `?outlines=off`
- `?textureDepth=off`

Explicitly editing a control saves that choice. Reset defaults restores graphics and sound defaults. Graphics uses `lantern.options.v1`, revision 6, preserving applicable existing preferences, including sharpening and the old quality-to-shadow/particle migration, while stripping retired fields. Rendering-method, render-scale and volumetric preferences/URLs are ignored.

Controls update immediately and submit immutable snapshots once per presentation frame. Structural graph changes settle for 150 ms, flushing the latest choice on close. Preparation is serialized; gameplay pauses and the last image remains visible during compilation. Failed replacements retain the working graph with an actionable menu error. Resolution Quality resizes existing buffers; two recently used effect graphs are retained at most. HTML UI remains on the main thread, so cold preparation can still stall it.

The renderer canvas's `data-graphics` JSON exposes recent frame intervals, scene/output dimensions, settings and FSR compute timings. Compute timings exclude scene rendering, the reactive opaque pass and later effects. Compare identical output buffers using [the performance protocol](PERFORMANCE.md#current-measurement-protocol).

## Runtime requirements

All routes require supported native WebGPU and hardware acceleration. Browser deployments require HTTPS; loopback development is supported. Electron uses a stable secure local origin for persistence, and hidden checks use a separate ignored profile and remain non-focusable. `--renderer=webgpu` is accepted only for compatibility; other backend values are rejected. Current launch commands are in [Development](DEVELOPMENT.md#commands-and-handoff).
