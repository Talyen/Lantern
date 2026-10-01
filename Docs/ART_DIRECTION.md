# Art direction — warm grimdark

Lantern is a weathered, dangerous fantasy world with welcoming pools of amber light. Diablo II informs the atmosphere and sense of refuge, rather than a literal reproduction of its assets. Painterly material detail adds age and character to low-poly shapes. Warm earth, copper and ochre midtones remain readable; the scene is neither vividly saturated nor uniformly black, icy, bleak or harsh.

## Palette and visual hierarchy

| Role | Direction | Starting swatch |
| --- | --- | --- |
| Stone | Warm gray mineral layers, charcoal cracks, sparse olive lichen | `#777568` |
| Wood and bark | Umber, quiet gray wear, restrained warm highlights | `#68523d` |
| Foliage | Weathered copper, rust and ochre in broad clusters; darker olive retained | `#ad6035` |
| Cloth and leather | Warm taupe, brown, limited rust-red wear | `#89715a` |
| Recesses and metal | Charcoal with visible midtones; tarnished highlights | `#454440` |
| Refuge and interaction | Amber firelight, small gold accents | `#e7ac65` |

The woodland uses weathered autumn colors. Existing pine silhouettes are deliberately stylized with copper, rust and ochre needle masses. Assign colors to coherent asset families and broad clusters; avoid random colors on individual triangles or an even mix of every swatch.

| Autumn color | Starting swatch | Role |
| --- | --- | --- |
| Burnt orange | `#AD6035` | Selected prominent foliage |
| Mustard yellow | `#AD9145` | Brighter foliage clusters and dry grass |
| Rust red | `#874739` | Main warm foliage variation |
| Olive green | `#626A45` | Lingering green in darker foliage clusters |
| Warm brown | `#68523D` | Soil, bark and quiet ground |
| Burgundy | `#653944` | Sparse darker shrub accents |
| Muted copper | `#AF8050` | Foliage highlights; nonmetallic |

These swatches establish relationships, not universal material tints. Preserve authored color differences between material regions and facets. Characters, enemies, ground contacts and paths must remain legible in both lighting moods. Keep combat ground quieter than surrounding scenery. Rare magic belongs to existing portals, loot and a few future landmarks; avoid ambient runes and pervasive glowing vegetation.

## Materials and projection

Use broad material shapes visible from the normal isometric camera: mineral strata, bark flakes, wood grain, foliage clusters, worn canvas and leather scuffs. Detail should enrich inspection views without creating shimmer or camouflage during combat. Preserve faceted normals and silhouettes. Strong normal maps, added geometry and photographic micro-noise are outside this pass.

The six original ImageGen sources and exact prompts are in [the environment manifest](../assets/textures/environment/manifest.json). They are generated from text only using the built-in tool. No licensed model, texture or render is submitted. Licensed sources, derived GLBs, baked maps and comparison captures remain private under `.local/` and `public/vendor/`.

Projection samples authored palette regions before changing UVs, then blends original surface color with that palette. Bark, foliage, timber, cloth and leather remain distinct on mixed-material props. Box projection blends stone across facets; directional grain belongs to bark and timber. Cut wood, rope, metal and glass retain locally authored color and material response. Preserve hierarchy, pivots, normals, vertex colors, alpha masks and chest articulation. Unwrap a temporary welded topology copy and transfer corner UVs back to the untouched mesh; this prevents subpixel atlas gaps on flat-normal exports. Sample palette swatches inside faces rather than their gutters. No continuous material noise is animated. Grass forms short continuous woodland carpets from narrow curved blades, with dark roots, weathered olive/straw tips and slow travelling wind. Feather the edges into quiet bare camp and path soil; avoid isolated triangular wedges and uniform lawns. Grass patches are authored through [level design](LEVEL_DESIGN.md).

Prepared variants cover the three selected pines, rock, log, bush, fern, crate, barrel, tent, bedroll, backpack, campfire, lantern, existing chest and existing cliff-rock study. Existing placements, collision, navigation and area composition are preserved. The original soil remains the ground source, recolored toward warm brown through the shared TSL material. Subdued copper/ochre staining stays near woodland edges; paths and combat ground remain quieter than foliage. The environment manifest owns stable foliage targets: copper, burnt orange/rust and ochre for the three pines, rust with burgundy shadows for bushes, and mustard/olive for ferns. Classify untouched authored regions before recoloring both sampled foliage and the original foliage texture contribution. Preserve their broad luminance variation. Per-asset value scales keep foliage midtones weathered under the shared lighting; bark and non-foliage regions retain their earlier treatment.

Run `node scripts/assets/surfaces/environment.mjs --help` for the local exporter. Default bakes are 1024 pixels. Runtime prefers available variants and falls back to original optional scenery. An authored-surface comparison is available only in development authoring.

## Golden and silver hour

Golden hour uses low-angle, muted golden sunlight with warm-gray sky fill. Silver hour uses low-angle, soft pewter moonlight with desaturated gray/olive fill. Silver is moonlit, not blue-black. Both keep strong local amber warmth from campfires, torches and lanterns. Local lights and physical environment response use the shared native WebGPU lighting and visual pipeline.

Choose golden or silver independently with equal probability at initial entry and each successful gameplay area transition. The same choice can repeat. Commit the mood with the loaded destination, including gate travel, campfire travel, portals and Return Home. Failed travel, menus, retry within an area and development hot reload retain the current mood. Apply changes behind area replacement and reset temporal history. No continuous clock, save migration or Rest action is introduced. A future safe campfire rest may become another selection event.

Development authoring can force either mood for matched comparisons. It must not add controls or implementation status to the gameplay HUD.

## Acceptance and evidence

Compare authored and projected scenery with identical camera, pose, zoom, lighting and graphics settings. Review golden and silver at minimum, normal and maximum gameplay zoom. Retain changes only when material regions and silhouettes remain clear, texture repetition/seams are unobtrusive, foliage edges remain intact, and enemies and paths are easy to see. Chest hinges and camp interactions must continue working.

Use representative gameplay flows for movement, animation-delayed hits, victory, defeat, retry, inspection and travel in both moods. Measure using [the performance protocol](PERFORMANCE.md), including texture memory, draw calls and resources after repeated travel. Finish with playable asset validation and the normal handoff gate. Keep local licensed-art captures private and record limitations honestly.

## Design principles

Make strong visual choices within this identity and the requested task. Choose and iterate independently; changes to the established identity or gameplay need a design discussion. More decoration or copy does not establish artistic improvement.

- **World:** weathered craft, painterly surfaces, readable silhouettes, and amber refuge within a dangerous landscape.
- **Composition:** asymmetrical arrangements with visual balance, clustered detail, quiet space, and a clear focal point.
- **UI:** an instrument belonging to this world. Use the existing iron, brass, and smoky-glass [orb treatment](../assets/ui/orbs/PROMPTS.md) as a concrete starting reference; apply ornament selectively according to importance.
- **Motion:** purposeful feedback with clear timing and controlled settling. Avoid constant animation that competes with combat or attention.
- **Restraint:** visual simplicity must feel intentional through proportion, alignment, material response, and finish.

Examples of stronger choices:

- Frame a camp with leaning woodland silhouettes, worn ground, and concentrated firelight instead of evenly scattering props.
- Compose an inventory through coordinated typography, spacing, selection treatment, and restrained material accents instead of leaving an untouched grid of controls.
- Coordinate contact timing, pose, and brief impact feedback for a hit response instead of adding unrelated particles for spectacle.

These examples guide visual decisions; they do not authorize unrelated redesigns or changes to combat rules.

## Visual review

Inspect the running result or local captures at gameplay scale. Use the existing [level authoring loop](LEVEL_DESIGN.md#fast-iteration) for areas. Record specific visible evidence in short working notes alongside captures, rather than numerical scores or claims such as "premium" or "polished."

- **Clear focus:** what draws attention first, and does that match the intended composition?
- **Recognizable Lantern identity:** where do weathered materials, painterly shapes, and amber refuge appear without overwhelming the scene?
- **Coherent details:** do typography, spacing, materials, lighting, ornament, and motion support the same direction?
- **Readable play:** can the player distinguish actors, contacts, paths, interactions, and menu states at the intended scale?
- **Finish:** what is the weakest visible part, and does its proportion, alignment, edge treatment, material response, or timing need another pass?

Compare the result with the stated intent, revise the weakest part when needed, and inspect again. Keep licensed-art captures private and retain the existing technical and gameplay acceptance requirements.

## Earlier olive-palette review — September 30, 2026

This review records the earlier olive-dominant woodland, before the autumn recolor. Six original sources were generated with the built-in ImageGen tool, with prompts and source hashes retained in the manifest. Sixteen locally projected GLBs cover the selected woodland and camp set, retaining triangle counts and named hierarchy. Matched authored/projected captures in Homestead and Clearing cover both moods at zoom 0.9, 1.35 and 2. The UV-topology correction removes the cliff-rock atlas gaps without changing the source mesh. Chest articulation and its wood/metal separation remain intact.

Native WebGPU browser flows pass movement/dodge, inspection, contact-timed attacks, victory, chest rewards, fire safety/healing, walking links, campfire travel, defeat, Return Home and restart in both moods. Private captures, source/bake reports, state checks and production performance samples live under `.local/environment-art/`. Performance evidence describes local presentation cadence and resource counts; other GPUs and Windows remain unverified.

The missing-variant check confirms original scenery loads when all sixteen prepared files are absent. Warmed travel keeps texture, geometry and render-target counts constant; small native uniform-buffer growth during repeated replacement is recorded for the separate lighting/cache follow-up, rather than described as fully stable GPU memory.

## Autumn woodland review — October 1, 2026

The five foliage variants now use weathered copper, burnt orange, ochre and rust with olive or burgundy shadows. Gameplay-scale review reduced their baked values to keep mustard from reading as pale yellow, and quieted Homestead's dry grass. Warm-brown soil and subdued edge staining preserve the paths and fighting space. Lighting profiles, flame recipes, geometry, hierarchy, alpha handling, scene transforms, collision and navigation retain their existing behavior. All six original texture hashes and prompt records remain intact.

Matched native WebGPU views cover both areas in golden and silver at zoom 0.9, 1.35 and 2, plus studio, authored-surface, moonlit-lantern, Soft and Cinematic comparisons. Movement/dodge, contact-timed hits, victory, chest use, defeat/retry, inspection and travel passed in both dusk moods. Original scenery also loaded with all prepared variants absent. Warmed travel retains texture, geometry and render-target counts; the existing small native uniform-buffer growth remains a separate follow-up. Private captures, integrity checks, resource records and production samples live under `.local/autumn-art/`. Windows and other GPU families remain unverified.

## Shared lighting profiles

Golden and silver are scoped variations of `woodland-dusk`, resolved centrally for gameplay and authoring. New environments choose an appropriate profile; neutral comparisons use `studio`. Keep family-wide tuning in profiles and intentional local differences in area overrides. See [lighting authoring](LIGHTING.md) for recipes, probe preparation, reference views and cache ownership.

The fixed-night trial uses a cool, subdued woodland environment with a warm personal lantern. Moonlit prioritizes combat readability; Deep night emphasizes the explored pool of light; Misty night softens distance. These are shared profile variants and developer comparisons, not an automatic day/night cycle. See [lighting authoring](LIGHTING.md).
