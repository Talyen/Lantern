# Graphics settings

Options contains Graphics and Sound, opens Keybindings, and pauses play while open. Escape opens/closes the menu. [Gameplay sound](AUDIO.md) owns sound controls and defaults; [combat controls](SMOKE_REFERENCES.md#combat-controls-and-focused-acceptance) owns input remapping. This page owns the graphics reference. Runtime defaults and parsing belong to `src/rendering/graphics-settings.ts`, with quality recipes in `src/rendering/quality-presets.ts`.

## Controls and defaults

| Control | Fresh/reset default | Choices or range |
| --- | --- | --- |
| Camera Distance | Default | Default, Far |
| Resolution Quality | Quality | Native, Quality, Balanced, Performance |
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

FSR Temporal is the sole reconstruction method. Output pixel ratio is always 1. Resolution Quality changes scene buffers without changing the window or display mode. The Scene → Output readout under Resolution Quality shows the actual scene-buffer and output dimensions, updating after a setting commits or the panel resizes. Native means the canvas’s CSS-pixel dimensions, not the monitor’s physical pixels; a small embedded browser panel therefore has a small output even at Native. Native uses 100% per axis, Quality uses 1/1.5, Balanced uses 1/1.7 and Performance uses 50%. Native WebGPU or FSR startup failure produces an actionable error; there is no renderer or reconstruction fallback. [Architecture](ARCHITECTURE.md#rendering-contract) owns this contract.

Shadow and particle quality are independent. Shadow quality changes map sizes while retaining authored light intensity and softness; fire shadows remain enabled. Particle Effects scales pool capacity, continuous emission and atmospheric density, preserving combat burst timing/counts. Atmospheric particles controls motes, smoke and embers, retaining flames, combat feedback, wind and water. Atmosphere adjusts preset distance fog; volume buffers, ray marching and bounded mist pockets are retired. Shared Golden lighting, local light recipes and explicit probe preparation belong to [Lighting](LIGHTING.md).

DOF follows reconstructed FSR output with a jitter-corrected bilateral depth guide and camera-target focus. Soft uses focus range 24 and bokeh 0.8; Cinematic uses 16 and 1.6. Off bypasses DOF. Invalid or old numeric DOF values use Cinematic. The character gallery uses the shared reconstruction defaults with AO 0.30, bloom 0 and DOF Off for inspection.

Outlines applies stronger warm-charcoal contours to actors/equipment and quieter contours to known solid props, excluding terrain, plants, scatter and effects. Contours run before FSR and stay inside visible surfaces, using existing depth/motion rejection. Their footprint targets 1.7 output pixels, with a one-scene-texel minimum and smooth coverage. Inspect a changed silhouette in motion at normal settings; thin weapons, alternate resolutions and occlusion probes are targeted diagnostics. The visual treatment belongs to [Art Direction](ART_DIRECTION.md#optional-outlines).

Material textures use fixed 16× anisotropic filtering and FSR-aware mip sampling with one additional finer mip: `clamp(log2(scene/output), −1, 0) − 1` (Quality approximately −1.585). This shared rule applies across gameplay, authoring and galleries at every resolution quality, with matching beauty/opaque-pass sampling. Foliage wind supplies its previous-frame deformation to FSR for steadier edges; authored wind animation stays the same. Texture Depth adds shallow parallax to suitable prepared ground, rock and bark regions. Off skips height searches while retaining normal maps, spatial roughness, restrained cavity shading and physical geometry. Both choices persist; fresh/reset selects On. Material ownership and preparation follow [Architecture](ARCHITECTURE.md#rendering-contract) and [Art Direction](ART_DIRECTION.md#materials-and-projection).

The surface adapter preserves texture transforms and uses the map's own coordinate frame for tangent-space normals when no authored tangents exist. Revalidate this boundary against the pinned three.js implementation on upgrades: a normal texture bound to a bake channel does not prove the derivative tangent frame uses that channel. Native resolution retains DOF; temporarily compare `?upscaleQuality=native&dof=off` when isolating material softness from lens blur, then inspect normal gameplay settings.

## Frame pacing and camera

Electron supplies its initial display refresh rate. First launch/reset chooses the highest listed cap no higher than that rate, allowing 1 Hz for nominal rates such as 59.94; otherwise it uses 60. Saved caps take precedence. Unlimited removes the application cap but retains requestAnimationFrame display pacing. Simulation and animation include skipped callback time, with the existing 50 ms stall clamp.

The orthographic camera has a 35-degree downward pitch and 45-degree azimuth. Camera Distance selects Default (distance multiplier 0.6) or Far (0.78), with zoom equal to the reciprocal of the multiplier. Default shows half the previous world span; Far shows 30% more world across each dimension. The choice applies immediately, persists across reloads and travel, and Reset selects Default. Gameplay wheel zoom and zoom keybindings are removed; temporary developer inspection and authored views restore the selected distance on return to gameplay. Existing area envelopes retain their saved dimensions. Camera ownership and follow behavior are documented in [Architecture](ARCHITECTURE.md#owners-and-data-flow).

## Temporary comparisons and persistence

Comparison URLs override settings for the current load without saving them through unrelated menu edits. Examples:

- `?upscaleQuality=quality&sharpness=0.2`
- `?upscaleQuality=performance`
- `?shadowQuality=low&particleQuality=low&atmosphericParticles=off&dof=off`
- `?outlines=off`
- `?textureDepth=off`

Explicitly editing a control saves that choice. Reset defaults restores graphics and sound defaults. Graphics uses `lantern.options.v1`, revision 8, preserving applicable existing preferences, including sharpening and the old quality-to-shadow/particle migration, while stripping retired fields. Rendering-method, render-scale and volumetric preferences/URLs are ignored.

Controls update immediately and submit immutable snapshots once per presentation frame. Structural graph changes settle for 150 ms, flushing the latest choice on close. Preparation is serialized; gameplay pauses and the last image remains visible during compilation. Failed replacements retain the working graph with an actionable menu error. Resolution Quality resizes existing buffers; two recently used effect graphs are retained at most. HTML UI remains on the main thread, so cold preparation can still stall it.

The renderer canvas's `data-graphics` JSON exposes recent frame intervals, scene/output dimensions, settings and FSR compute timings. Compute timings exclude scene rendering, the reactive opaque pass and later effects. Compare identical output buffers using [the performance protocol](PERFORMANCE.md#current-measurement-protocol).

## Runtime requirements

All routes require supported native WebGPU and hardware acceleration. Browser deployments require HTTPS; loopback development is supported. Electron uses a stable secure local origin for persistence, and hidden checks use a separate ignored profile and remain non-focusable. `--renderer=webgpu` is accepted only for compatibility; other backend values are rejected. Current launch commands are in [Development](DEVELOPMENT.md#commands-and-handoff).

## Presentation preferences

Camera Shake, Resource Numbers and Weather Effects are saved On/Off controls, On for fresh/reset settings. Resource Numbers hides visible HP/MP text only. Camera Shake Off removes an active offset immediately; hit pause has no option. Existing-player Weather Effects is seeded from the old Atmospheric particles preference once, then persists independently. Weather Off removes precipitation/contact effects and rain ambience while retaining authored wet ground, water, wind and fog. Preserve all other preferences when migrating.

## Private FSR comparisons

In a task-owned authoring preview, `npm run fsr:compare -- --preset baseline` captures the Quality/1920×1080 reference. Follow with `sharpness-0`, `sharpness-1`, `foliage-motion`, `reactive-coverage`, `mip-minus-half` or `mip-minus-one`. The command records eight simulation seconds at 60 fixed steps per second, plus full-resolution stills and velocity/reactivity inputs, under ignored `.local/level-design/fsr-comparison/`. Baseline must be captured first; candidates must match its source signature, scene content and simulation/effect/camera checkpoints. Encoding timestamps describe the replay, not measured runtime FPS. If a bounded command exits while a slow take is still advancing, `npm run fsr:compare -- --preset <same-preset> --collect` collects that existing take without starting it again.

The development-only `?author=levels&fsrCompare=baseline` controls offer preset selection and replay. Comparisons use the shared visual graph, reset history and settle 64 frames after two seconds of seeded effect warm-up. They temporarily use a camp inspection with enemy AI suspended and preserve player preferences. Current Clearing placements do not enable the general foliage-wind helper; every comparison take enables that existing helper on the same authored tree meshes to exercise its motion vectors. This fixture is private and does not adopt tree wind for normal play. Normal routes adopt corrected foliage motion and the −1.0 mip offset; expanded reactive coverage remains unadopted. Production ignores comparison URLs. Sharpening defaults to 0.50. Private presets retain the original baseline and change one variable at a time: Quality bias approximately −0.585, with candidates −1.085 and −1.585. Captures and licensed scene imagery remain private.

Generate the simple visual preview with `node scripts/levels/fsr-report.mjs --directory <capture-directory>`. It needs only the matched `sharpness-0`, `baseline` and `sharpness-1` manifests and full-resolution `still.png` files. Soft / Current / Crisp buttons switch one enlarged frame in place, with the helmet, axe and ground texture cropped consistently. The preview omits video controls, technical inputs and the motion/mask/mip pairs whose visible differences were too subtle in this capture. Full captures remain private for focused investigation; identical additional PNG crops are available through `python3 scripts/levels/fsr-crops.py --directory <capture-directory> --boxes <crop-boxes.json>`.

### Focused motion examples

For comparisons that were too subtle at gameplay scale, open one owned preview with `npm run agent:dev -- --browser --author --lab fsr`. The development-only route uses the same native renderer and shared FSR pipeline, Quality, sharpening 0.50 and the Golden light recipe. Diagnostic geometry frames thin leaf tips against a plain backdrop; a texture-animated smoke billboard uses the shipping smoke color and soft falloff, with opacity 0.65 in both sides to make dense-transparency behavior visible; an original synthetic weave exposes texture sampling during a slow pan. Both sides omit depth-of-field blur. The diagnostic geometry and smoke density stay private; normal routes now adopt the foliage-motion and −1.0 mip-offset candidates.

Capture a pair with `node scripts/agents/run.mjs --resource gpu --reuse-preview -- node scripts/levels/fsr-focused.mjs --subject foliage`, then the same command with `--candidate`. Subjects are `foliage`, `smoke` and `texture`; texture compares the original pre-adoption bias against the adopted −1.0 offset candidate. Four-second clips and lossless stills stay under ignored `.local/level-design/fsr-focused/`. `--collect` resumes collection of an advancing take without restarting it. Generate the simple Original/Adopted comparison page (the retained capture viewer labels these Current/Candidate) with `node scripts/levels/fsr-focused-report.mjs`. The review page shows leaf edges and the texture tradeoff; smoke trials remain recorded but are omitted from review choices because their visible gain remained unclear. Camera, effect state and source signatures must match within each pair. These controlled close-ups show possible artifacts and tradeoffs, not a guaranteed normal-gameplay improvement.
