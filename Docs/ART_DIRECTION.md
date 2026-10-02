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

These swatches establish relationships, not universal material tints. Preserve authored color differences between material regions and facets. Characters and nearby ground contacts must remain legible within warm light pools; distant woodland detail can recede into darkness. Keep combat ground quieter than surrounding scenery. Rare magic belongs to existing portals, loot and a few future landmarks; avoid ambient runes and pervasive glowing vegetation.

## Materials and projection

Use broad material shapes visible from the normal isometric camera: mineral strata, bark flakes, wood grain, foliage clusters, worn canvas and leather scuffs. Detail should enrich inspection views without creating shimmer or camouflage during combat. Preserve faceted normals and silhouettes. Broad normal-map relief and restrained cavity/roughness variation reinforce these forms. POM adds shallow apparent relief to suitable earth, litter, rock and bark regions; avoid photographic micro-noise or uniformly embossed surfaces. Prepared rock bevels and irregular pine tiers add purposeful geometry without a terrain rebuild.

The six original ImageGen sources and exact prompts are in [the environment manifest](../assets/textures/environment/manifest.json). They are generated from text only using the built-in tool. No licensed model, texture or render is submitted. Licensed sources, derived GLBs, baked maps and comparison captures remain private under `.local/` and `public/vendor/`.

Projection samples authored palette regions before changing UVs, then blends original surface color with that palette. Bark, foliage, timber, cloth and leather remain distinct on mixed-material props. Box projection blends stone across facets; directional grain belongs to bark and timber. Cut wood, rope, metal and glass retain locally authored color and material response. Preserve hierarchy, pivots, normals, vertex colors, alpha masks and chest articulation. Unwrap a temporary welded topology copy and transfer corner UVs back to the untouched mesh; this prevents subpixel atlas gaps on flat-normal exports. Sample palette swatches inside faces rather than their gutters. No continuous material noise is animated. Grass forms short continuous woodland carpets from narrow curved blades, with dark roots, weathered olive/straw tips and slow travelling wind. Feather the edges into quiet bare camp and path soil; avoid isolated triangular wedges and uniform lawns. Grass patches are authored through [level design](LEVEL_DESIGN.md).

Prepared variants cover the three selected pines, rock, log, bush, fern, crate, barrel, tent, bedroll, backpack, campfire, lantern, existing chest and existing cliff-rock study. Existing placements, collision, navigation and area composition are preserved. Ground uses the original painted earth, litter and rocky-soil sources from the woodland study, with locally authored normal/height/roughness/cavity fields. Height-aware transitions preserve individual material marks; worn routes and combat ground remain quiet. Subdued copper/ochre staining stays near woodland edges; paths and combat ground remain quieter than foliage. The environment manifest owns stable foliage targets: copper, burnt orange/rust and ochre for the three pines, rust with burgundy shadows for bushes, and mustard/olive for ferns. Classify untouched authored regions before recoloring both sampled foliage and the original foliage texture contribution. Preserve their broad luminance variation. Per-asset value scales keep foliage midtones weathered under the shared lighting; bark and non-foliage regions retain their earlier treatment.

Run `node scripts/assets/surfaces/environment.mjs --help` for the local exporter. Supporting bakes are 1024 pixels; pines, rocks, logs, tents and the chest use 2048 pixels with larger atlas margins. Runtime prefers available variants and falls back to original optional scenery. An authored-surface comparison is available only in development authoring.

### Weathered woodland showcase

The development-only **Woodland showcase** surface selection studies one section of Forest Clearing around `entrance`. Worn earth stays quiet along the approach; copper leaf litter gathers around woodland edges and rocky soil settles around three selected rocks. The selected broad pine uses cylindrical bark grain, broad shaded canopy interiors and restrained needle tips. Controlled canopy shaping breaks uniform tiers while preserving the trunk, original bounds, hierarchy and harvest/collision identity. Rocks keep their shape and use quieter mineral bands with sparse olive weathering. Golden lighting stays fixed for the comparison.

The opt-in recipes, selected placement IDs and bounded ground patches belong to `showcase` in [the environment manifest](../assets/textures/environment/manifest.json). Five original text-only material images and exact prompts/hashes live in [showcase sources](../assets/textures/environment/showcase/sources.json). Generated imagery supplies surface marks; local region masks, directional mapping and placement finish the treatment. This earlier comparison remains available in authoring. Its original color sources now also support the default tactile treatment across Clearing and Homestead; material-data preparation stays local and agent-led.

## Tactile material treatment

Use fixed 16× anisotropic filtering on mipmapped 3D material textures. Material sampling uses a conservative FSR-resolution bias; reconstruction/depth buffers keep their existing filters. Keep Cinematic DOF and judge improvements in the focused play space as well as motion. Do not remove mipmaps or mesh LOD support to make textures appear sharper.

Normal maps carry broad relief that catches Golden sunlight and local flames; roughness and cavity fields stay enabled. Texture Depth is a saved On/Off option, On by default, controlling bounded TSL parallax searches only. Off retains normal maps, material variation and physical geometry. Color, normal and material fields share displaced coordinates; POM fades at atlas borders and never writes fragment depth or changes collision. Probe captures use stable non-parallax material shading. Preserve useful authored character normals and all original text-prompted color files.

Small locally prepared rock bevels remain inside existing collision footprints. Pine shaping preserves bounds, trunk, pivots and harvest identity. Foliage remains composed in broad solid masses; cutouts are not added where they would undermine that silhouette. No broad uneven-floor displacement, relief/cone-step mapping, compression or streaming is part of this upgrade.

## Golden woodland and amber refuge

Homestead and Forest Clearing use the approved Golden appearance with balanced honey-gold sunlight from `src/levels/lighting-preset.ts`. Honey-gold sunlight brings out copper, rust and ochre, while restrained cool sky fill and local bounce keep shaded ground readable without flattening the light. Preserve deep tree/prop shadows and material color. Use full material saturation and lighter grading than the earlier muted Golden look; do not compensate with higher player exposure or a global orange filter.

The sun and local flames both have a strong presence. Sunlight is honey-gold; campfires and lanterns are deeper amber, so their nearby pools remain distinct even during daylight.

Campfires, torches and lanterns share amber `#ffad55` illumination. Distinguish them through intensity, reach, emitter height and subtle flicker. Campfires have broad pools with world shadows; the personal lantern follows the rig and uses an elevated effective emitter plus short-range warm owner bounce to reach torso and face while turning. Native point-light falloff feathers warmth into the dark surroundings. Keep bright centers controlled rather than whitening every nearby surface with bloom.

Travel, Return Home and restart use the same Golden baseline; there is no random gameplay mood or day/night clock. Area overrides may adjust light direction or coverage without changing this identity. Future enclosed areas should retain strong local warmth and readable shadow contrast. Adapt sun coverage and probe volumes through area overrides; a different environment or palette requires a deliberate change to the shared lighting design.

This is the sole lighting preset, including the character gallery, animation lab, authoring and blockout areas. Alternative looks, random entry moods and preset selection controls are removed. Small area overrides adapt placement and coverage without defining a second aesthetic.

## Acceptance and evidence

Use the [lean task workflow](DEVELOPMENT.md#working-alongside-other-agents): one representative preview at normal gameplay scale, plus the changed interaction when relevant. Judge material separation, silhouettes, actor/path readability and the intended composition; fix a visible weakness in the same session. Screenshots are optional and licensed-art captures remain private.

Matched authored/projected views, zoom extremes and resource measurements are optional targeted tools for a specific uncertainty or requested audit. Do not run every gameplay flow or a benchmark to accept an ordinary visual edit. The fast sanity gate protects basic integration; a screenshot or passing build alone does not establish good design.

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

## Loot presentation

Ground loot should feel physical and readable within the weathered autumn world: small recognizable objects briefly toss, tumble, and settle, with restrained landing and collection sounds. Keep combat as the focal point; avoid persistent loot beams, glow, and constant idle motion.

Use mixed-case Pirata One Gothic names on compact smoky charcoal backplates, with warm ivory lettering, muted gold for gold, and a restrained brass hover edge. Show only the item name. Separate crowded labels into quiet non-overlapping rows, keep text at a stable screen size across zoom, and link hover to the matching object. Labels remain readable over scenery. The [loot design](LOOT.md#labels-and-visual-treatment) owns starting colors, sizes, distances, and interaction rules; this treatment is implemented for equipment, scrolls, Health Potions, Wood, Stone and Iron. Gold uses the same physical treatment with muted-gold labels and tarnished coin piles. Inspect Gothic readability, object recognition and combat visibility in one normal gameplay preview; additional views/zooms are optional if a specific readability concern appears.

## Optional outlines

Outlines add soft warm-charcoal definition inside the visible silhouettes of characters, equipment and selected solid camp/rock props. Actors receive stronger contours than scenery. Preserve painterly materials and existing light; dark contours never become a bright rim in deep shadow. Terrain, grass, plants, scattered detail and effects remain quiet. Default/reset is On. Width stays close to 1.5–2 output pixels, with continuous coverage and pre-FSR temporal reconstruction. Judge the result in motion as well as matched stills: no distracting edge crawl, flicker, jagged steps, changing thickness or trails at gameplay scale. For normal tuning, inspect the changed contour in motion in one gameplay preview. Additional viewpoints and zoom extremes are targeted diagnostics.

## Visual review

Inspect the running result or local captures at gameplay scale. Use the existing [level authoring loop](LEVEL_DESIGN.md#fast-iteration) for areas. Describe a specific visible result briefly; captures and separate review reports are optional. Avoid numerical scores or unsupported quality claims.

- **Clear focus:** what draws attention first, and does that match the intended composition?
- **Recognizable Lantern identity:** where do weathered materials, painterly shapes, and amber refuge appear without overwhelming the scene?
- **Coherent details:** do typography, spacing, materials, lighting, ornament, and motion support the same direction?
- **Readable play:** can the player distinguish actors, contacts, paths, interactions, and menu states at the intended scale?
- **Finish:** what is the weakest visible part, and does its proportion, alignment, edge treatment, material response, or timing need another pass?

Compare the result with the stated intent, revise the weakest part when needed, and inspect again. Keep licensed-art captures private and use the lean sanity-check policy; expand review only for a concrete reason.

## Earlier olive-palette review — September 30, 2026

This review records the earlier olive-dominant woodland, before the autumn recolor. Six original sources were generated with the built-in ImageGen tool, with prompts and source hashes retained in the manifest. Sixteen locally projected GLBs cover the selected woodland and camp set, retaining triangle counts and named hierarchy. Matched authored/projected captures in Homestead and Clearing cover both moods at zoom 0.9, 1.35 and 2. The UV-topology correction removes the cliff-rock atlas gaps without changing the source mesh. Chest articulation and its wood/metal separation remain intact.

Native WebGPU browser flows pass movement/dodge, inspection, contact-timed attacks, victory, chest rewards, fire safety/healing, walking links, campfire travel, defeat, Return Home and restart in both moods. Private captures, source/bake reports, state checks and production performance samples live under `.local/environment-art/`. Performance evidence describes local presentation cadence and resource counts; other GPUs and Windows remain unverified.

The missing-variant check confirms original scenery loads when all sixteen prepared files are absent. Warmed travel keeps texture, geometry and render-target counts constant; small native uniform-buffer growth during repeated replacement is recorded for the separate lighting/cache follow-up, rather than described as fully stable GPU memory.

## Autumn woodland review — October 1, 2026

This historical review predates the sole shared Golden preset. Its alternate moods and studio comparisons are no longer runtime choices.

The five foliage variants now use weathered copper, burnt orange, ochre and rust with olive or burgundy shadows. Gameplay-scale review reduced their baked values to keep mustard from reading as pale yellow, and quieted Homestead's dry grass. Warm-brown soil and subdued edge staining preserve the paths and fighting space. Lighting profiles, flame recipes, geometry, hierarchy, alpha handling, scene transforms, collision and navigation retain their existing behavior. All six original texture hashes and prompt records remain intact.

Matched native WebGPU views cover both areas in golden and silver at zoom 0.9, 1.35 and 2, plus studio, authored-surface, moonlit-lantern, Soft and Cinematic comparisons. Movement/dodge, contact-timed hits, victory, chest use, defeat/retry, inspection and travel passed in both dusk moods. Original scenery also loaded with all prepared variants absent. Warmed travel retains texture, geometry and render-target counts; the existing small native uniform-buffer growth remains a separate follow-up. Private captures, integrity checks, resource records and production samples live under `.local/autumn-art/`. Windows and other GPU families remain unverified.

## Shared lighting preset

The approved Golden preset is resolved centrally on every route. Keep shared tuning in `src/levels/lighting-preset.ts` and small placement/coverage differences in area overrides. See [lighting authoring](LIGHTING.md) for recipes, probe preparation, reference views and cache ownership.


## Agent visual workflow

Read this section before any player-facing visual change.

### Artistic responsibility

- Treat player-facing visual work as authored design. A functional first pass is a starting point; finish the composition, hierarchy, material treatment, and interaction details.
- Make a clear artistic choice within Lantern's established direction. Choose and iterate independently within the requested scope; ask when a choice would change the project's identity or gameplay.
- Before implementing, state the intended visual effect in one or two concrete sentences. Describe what the player will see and feel, and which visual decisions will create it. Keep this in working notes or commentary, never in the game.
- Establish a focal point and supporting hierarchy. Use deliberate silhouette, proportion, spacing, value contrast, lighting, and motion. Give important elements character; let supporting elements stay quiet.
- Prefer a few distinctive, coordinated decisions over many decorative additions. Default component styling, uniform prop distribution, and indiscriminate glow are unfinished when they undermine the intended composition.
- Inspect the actual result at gameplay scale. Identify the weakest visible part, revise it, and inspect again when needed. Passing checks or producing a screenshot does not establish visual quality.
- Communicate through the design before adding words. Do not compensate for weak visuals with slogans, descriptive headings, explanatory panels, or ornamental lore.

### Player-facing UI

- Use familiar menu names and predictable interactions, with compact layouts and a visual treatment specific to Lantern. Familiar behavior does not require default styling. Keep settings labels and values concise.
- Do not add slogans, narrative flavor text, prototype/lab branding, explanatory paragraphs, or instructional/status panels unless the user requests them or they are necessary for an actionable error.
- Keep the gameplay HUD limited to useful game state. Put settings and controls inside menus rather than around the scene.
- Keep implementation details out of player-facing text. Use short tooltips only when they help the player choose a setting.
