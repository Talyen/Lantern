# Art direction — warm grimdark

Lantern is a weathered, dangerous fantasy world with welcoming pools of amber light. Diablo II informs the atmosphere and sense of refuge, rather than a literal reproduction of its assets. Painterly material detail adds age and character to low-poly shapes. Warm earth, copper and ochre midtones remain readable; the scene is neither vividly saturated nor uniformly black, icy, bleak or harsh.

The player uses the supplied B1 Adventurer appearance; selected art, rig, authored lantern and preparation acceptance belong to [protagonist appearance](PROTAGONISTS.md). Preserve authored character features before exploring color changes.

## Quality and cost philosophy

A sharp, stable gameplay image comes first. Preserve warm-grimdark atmosphere and painterly broad forms while reducing blur, aliasing, ghosting, noisy fine detail and muddy blending. Judge visual quality in motion at the normal gameplay camera, not only close-up stills. Future asset replacements should inherit reusable renderer and preparation improvements; do not invest in manual revisions of outgoing models and textures solely for performance.

Every effect must justify its measured cost with a visible gameplay-scale benefit. Prefer clear lighting, value contrast, contact shadows and coherent material shapes before adding postprocessing or simulated micro-detail. Redesign or omit expensive effects with only small or moderate benefits. Multiple passes are legitimate tools, but repeated shading requires a specific reason. Better quality is allowed to use different algorithms and defaults; preserving an ineffective implementation is not the goal.

Depth of field is selective: keep the player and interactive combat region sharp, use controlled background blur, and reject foreground halos or blurred cues. Outlines are optional readability tools, not a mandatory aesthetic; retain them only where they materially improve silhouettes. Sharpening must not disguise unstable reconstruction or amplify texture noise.

[Graphics](GRAPHICS.md) owns physical output and FSR semantics; [Performance](PERFORMANCE.md#quality-and-performance-acceptance) owns budgets and comparisons.

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

Ability target footprints should be subtle and thematic, with subdued surface colours, soft edges and irregular marks. Avoid bright glowing targeting shapes and prominent filled areas. Arrow Rain's footprint uses a faint broken earthen perimeter; the arrows and their impacts carry the emphasis.

## Materials and projection

Use broad material shapes visible from the normal isometric camera: mineral strata, bark flakes, wood grain, foliage clusters, worn canvas and leather scuffs. Detail should enrich inspection views without creating shimmer or camouflage during combat. Preserve faceted normals and silhouettes. Broad normal-map relief and restrained cavity/roughness variation reinforce these forms. POM adds shallow apparent relief to suitable earth, litter, rock and bark regions; avoid photographic micro-noise or uniformly embossed surfaces. Prepared rock bevels and irregular pine tiers add purposeful geometry without a terrain rebuild.

The six original ImageGen sources and exact prompts are in [the environment manifest](../assets/textures/environment/manifest.json). They are generated from text only using the built-in tool. No licensed model, texture or render is submitted. Licensed sources, derived GLBs, baked maps and comparison captures remain private under `.local/` and `public/vendor/`.

Projection samples authored palette regions before changing UVs, then blends original surface color with that palette. Bark, foliage, timber, cloth and leather remain distinct on mixed-material props. Box projection blends stone across facets; directional grain belongs to bark and timber. Cut wood, rope, metal and glass retain locally authored color and material response. Preserve hierarchy, pivots, normals, vertex colors, alpha masks and chest articulation. Unwrap a temporary welded topology copy and transfer corner UVs back to the untouched mesh; this prevents subpixel atlas gaps on flat-normal exports. Sample palette swatches inside faces rather than their gutters. No continuous material noise is animated. Grass forms short continuous woodland carpets from narrow curved blades with varied taper and lean, mostly short growth and occasional taller tufts. Smooth seeded fields group density and height; broad weathered olive/straw tip colors, dark roots and slow travelling wind avoid uniform lawns and per-blade color speckles. Ground tint follows the same growth coverage so gaps reveal the painted soil. Feather the edges into quiet bare camp and path soil; avoid isolated triangular wedges and uniform lawns. Grass patches are authored through [level design](LEVEL_DESIGN.md).

Prepared variants cover the retained log, barrel, tent, bedroll, backpack and campfire. Following asset review, the scenes use authored Golden larch, copper bracken, autumn shrubs, forest rocks, wooden crates and iron lanterns from the library; the camp chests use their approved original appearance. Placement IDs, collision, navigation and gathering ownership remain intact. These are rough scenery replacements for the evolving prototype. The player's carried lantern model belongs to `player.lanternModel` in [the playable-character configuration](../assets/playable-characters.json), shared by runtime loading, asset review and build staging.

Ground uses the original painted earth, litter and rocky-soil sources from the woodland study, with locally authored normal/height/roughness/cavity fields. Height-aware transitions preserve individual material marks; worn routes and combat ground remain quiet. Subdued copper/ochre staining stays near woodland edges; paths and combat ground remain quieter than foliage. The environment manifest owns retained preparation recipes. Classify untouched authored regions before recoloring both sampled foliage and the original foliage texture contribution. Preserve their broad luminance variation and keep foliage midtones weathered under shared lighting.

Run `node scripts/assets/surfaces/environment.mjs --help` for the local exporter. Supporting bakes are 1024 pixels; pines, rocks, logs, tents and the chest use 2048 pixels with larger atlas margins. Runtime prefers available variants and falls back to original optional scenery. An authored-surface comparison is available only in development authoring.

### Reactive vegetation and tree felling

Grass parts around the player and nearby living enemies, with fixed roots and a short recovering trail. Low plants retain their authored silhouettes: ferns and explicitly opted-in flowers use a soft response, while bushes use a stiffer response. Canonical bush/fern assets are classified before prepared-surface substitution; placement `vegetation: "soft"`, `"shrub"` or `false` overrides that classification. No new flower placements are implied. Existing `foliage` wind authoring remains independent.

The shared [vegetation owner](../src/rendering/vegetation.ts) uses four bounded actor influences and static geometry/instance metadata, retaining current grass density and scenery batching. Node deformation includes matching normals, previous-frame positions and padded bounds through the shared native pipeline. Judge parting and recovery at the ordinary gameplay camera: no rubbery silhouettes, sliding roots or temporal trails. Proximity reactions do not alter collision or navigation.

The final chop triggers a brief cosmetic tree topple and opaque alpha-hashed disappearance, leaving the existing stump. Fall directions prefer open ground away from the player; conservative canopy support limits the tilt. Existing models, debris and audio provide the complete reaction. No falling-tree damage, physical logs, new art or persistent fall poses are added. See [Gathering](GATHERING.md#contextual-gathering) for the authoritative depletion and restoration behavior.

### Weathered woodland showcase

The original pine appearance was removed after asset review. The unused rock study, original source textures and ground study remain available for inspection; the description below records that earlier study.

The development-only **Woodland showcase** surface selection studies one section of Forest Clearing around `entrance`. Worn earth stays quiet along the approach; copper leaf litter gathers around woodland edges and rocky soil settles around three selected rocks. The selected broad pine uses cylindrical bark grain, broad shaded canopy interiors and restrained needle tips. Controlled canopy shaping breaks uniform tiers while preserving the trunk, original bounds, hierarchy and harvest/collision identity. Rocks keep their shape and use quieter mineral bands with sparse olive weathering. Golden lighting stays fixed for the comparison.

The opt-in recipes, selected placement IDs and bounded ground patches belong to `showcase` in [the environment manifest](../assets/textures/environment/manifest.json). Five original text-only material images and exact prompts/hashes live in [showcase sources](../assets/textures/environment/showcase/sources.json). Generated imagery supplies surface marks; local region masks, directional mapping and placement finish the treatment. This earlier comparison remains available in authoring. Its original color sources now also support the default tactile treatment across Clearing and Homestead; material-data preparation stays local and agent-led.

## Tactile material treatment

Use fixed 16× anisotropic filtering on mipmapped 3D material textures. Material sampling uses the resolution bias plus one finer mip, as defined in [Graphics](GRAPHICS.md#controls-and-defaults); reconstruction/depth buffers keep their existing filters. Keep Cinematic DOF and judge improvements in the focused play space as well as motion. Do not remove mipmaps or mesh LOD support to make textures appear sharper.

Normal maps carry broad relief that catches Golden sunlight and local flames; roughness and cavity fields stay enabled. Texture Depth is a saved On/Off option, On by default, controlling bounded TSL parallax searches only. Off retains normal maps, material variation and physical geometry. Color, normal and material fields share displaced coordinates; POM fades at atlas borders and never writes fragment depth or changes collision. Probe captures use stable non-parallax material shading. Preserve useful authored character normals and all original text-prompted color files.

Dry surfaces catch soft, restrained highlights; stronger glints belong to metal, glass and water. The shared surface adapter uses native Physical node materials and `dryHighlights` in `assets/material-recipes.json`: dielectric specular strength transitions from authored response at roughness 0.45 to 35% at 0.85. It reads authored roughness, including local maps and ground wetness, before geometric antialiasing adds roughness at edges. Metallic masks retain the metallic branch; smooth glass and the dedicated water material retain their response. Keep Golden lighting fixed when authoring this distinction. Material copies used for vegetation and felling preserve the same response. Review fingerprints include this policy, and changing it invalidates static irradiance bakes.

The shared surface adapter derives tangent frames from the normal map's actual transformed coordinates when authored tangents are absent. Prepared palette meshes often have collapsed UV0 and use a separate bake channel; terrain uses world projection. The pinned r186 `normalMap()` derivative frame assumes UV0 and must not handle these surfaces. Retain supplied authored tangents and object-space maps. Material sampling must also preserve repeat, offset and rotation; explicit TSL coordinates bypass the default texture transform.

Primitive stone uses matching locally prepared color, normal, roughness and cavity fields on each triplanar projection. Do not reduce masonry and gathering outcrops to painted color alone. Keep mineral marks aligned with their shading, preserve the existing silhouettes, and retain indirect-light cavity response rather than painting global darkness into color.

Small locally prepared rock bevels remain inside existing collision footprints. Pine shaping preserves bounds, trunk, pivots and harvest identity. Foliage remains composed in broad solid masses; cutouts are not added where they would undermine that silhouette. No broad uneven-floor displacement, relief/cone-step mapping, compression or streaming is part of this upgrade.

### Clearing approach and camp

Forest Clearing is the first composed woodland material pass. Its existing models form uneven woodland masses around a continuous approach and open camp. Larger copper leaf banks, mineral transitions and feathered olive grass connect the scenery. Trails use continuous authored centerlines to expose the earth material through litter, with broken feathered edges and matching grass clearance. Do not build trails from repeated circular color stamps or flat brown overlays. Paths, arrivals and fighting ground remain quiet. The three gathering outcrops retain their geometry and identity with painted mineral surfaces.

Clearing-specific variants belong to `areaAssets.clearing` in the environment manifest. They retain the previous prepared geometry, normals and hierarchy while increasing painted texture contribution, grouping canopy interiors and needle tips, and adding object-space lower-edge wear. `areaPreparation.clearing` owns material-field response; per-asset mapping owns scale, contrast and texture contribution. Existing original color sources are reused. Ground sampling and material scale belong to `woodlandGroundRecipeFor` in `src/rendering/woodland-ground.ts`; placement belongs to the area definition. Homestead and the other areas retain their existing treatment until deliberately authored. Golden lighting and graphics defaults stay shared.

Prepare these variants with `environment.mjs --area clearing`, then `pack.mjs --area clearing`, using the owned heavy-resource wrapper from [asset preparation](ASSET_PREPARATION.md#optional-scenery-and-surface-studies). Reload the owned preview before inspection and explicitly refresh Clearing's projected lighting bake. Licensed derivatives and gameplay captures remain private.

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
- **UI:** an instrument belonging to this world. Use the existing iron, brass, and smoky-glass [orb treatment](../assets/ui/orbs/PROMPTS.md) as a concrete starting reference; apply ornament selectively according to importance. The [UI design system](UI_DESIGN.md) owns the adopted warm, crafted direction, proposed foundations and shared component rules.
- **Interaction:** every meaningful action receives timely, perceptible, truthful feedback under the shared [interaction feedback principle](INTERACTION_FEEDBACK.md). A clear natural result can suffice; essential outcomes remain understandable without sound.
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

- Read the [UI design system](UI_DESIGN.md) and [screen design workflow](ui/WORKFLOW.md) before screen/component design. Keep briefs, original ImageGen concepts and adopted decisions in their documented owners; validate interaction and layout in the actual DOM implementation.
- Use familiar menu names and predictable interactions, with compact layouts and a visual treatment specific to Lantern. Familiar behavior does not require default styling. Keep settings labels and values concise.
- Do not add slogans, narrative flavor text, prototype/lab branding, explanatory paragraphs, or instructional/status panels unless the user requests them or they are necessary for an actionable error.
- Keep the gameplay HUD limited to useful game state. Put settings and controls inside menus rather than around the scene.
- Keep implementation details out of player-facing text. Use short tooltips only when they help the player choose a setting.

## Material calibration and durable checks

`assets/material-recipes.json` owns material height in metres, normal strength, prepared-family relief, stone projection scale, ground sampling scales and field-profile roughness/cavity response. Preparation and runtime read this same file. Ground normals compensate for the ratio between their bake sampling scale and current world sampling scale; changing tile size must not silently change relief. Prepared atlases retain authored tangents, colors and geometry. Re-prepare affected fields/atlases when physical height or field profiles change, then explicitly refresh affected lighting bakes.

Use the development authoring **Material relief** controls for Stone, Bark and Ground: Relief off, 1×, 1.5× and 2×. These are temporary coupled normal/height multipliers, never player preferences. Keep Golden lighting, camera, pose and texture scale fixed; Replay repeats the encounter setup, and Reset material comparisons restores all families to 1×. Inspect a candidate at Native with DOF Off to diagnose texture response, then at shipping Quality/Cinematic settings and during movement. Choose each family independently. Reject swelling, stretched parallax, atlas-border artifacts, animated sparkle, embossed color stains, or ground detail competing with actors/routes. Record adopted values in the recipes, not in debug controls. Roughness/cavity can be refined in the same family's field profile; do not use a global darkness or gloss multiplier.

`npm run materials:check` validates present prepared GLBs for required maps, usable sampled UVs, shared height/color frames, tangents and atlas dimensions. Raw palette UVs may be collapsed; the normal map's sampled channel must have usable coverage. Runtime import diagnostics also identify incomplete materials. Export preparation rejects invalid outputs. Missing optional licensed scenery remains supported and explicitly counted.

Run `npm run materials:probe` in an owned authoring preview after changing the adapter, recipes, probe fixture or pinned rendering dependencies. The probe uses original synthetic maps through the shared Native WebGPU/FSR pipeline, testing alternate UV channels, transforms, authored tangents, sidedness, active parallax, atlas masks and the actual 16× sampler descriptor. It records source-bound passing evidence and private images under `.local/level-design/material-probe/`. The change-aware local gate rejects missing/stale proof for those changes. Asset-free CI performs structural acceptance and reports the remaining native-hardware requirement; it does not claim to have rendered the probe. No periodic test or benchmark is scheduled.

Native, DOF-off gameplay-scale comparisons selected 1.5 times the coupled normal/height relief for prepared stone and bark, primitive stone and Clearing ground. Two times made the soil ridges too prominent and added little useful trunk structure. Other ground areas keep their baseline gain. This is an authored starting point, not a universal maximum: use the comparison controls for future surfaces and recheck movement under the shipping Quality/Cinematic settings.

## October 2 presentation polish

The adopted [orb-led HUD](ui/concepts/hud-polish/README.md) uses original detailed iron/brass chrome and painted ability/utility art, live values and binding plaques. The visible set control is removed. Resource Numbers is saved independently of the glass/liquid and accessible meter values.

Clearing connects the caster branch through continuous worn ground, groups camp supplies and adds a shallow walkable approach stream with restrained rain. Wet material response follows authored ground patches and water banks; there is no global wet gloss. Homestead's worn paths connect real interactions and the repaired shelter adds braces and orderly belongings while retaining the stash approach. Graveyard Ruins has a quiet chapel approach through edge litter/mineral accumulation; Crypt uses subdued tile variation to distinguish the hall procession and tomb. Golden lighting and current encounter/resource identities remain authoritative.

Combat now permits brief selective hit pause and strongest-Skill camera shake, approved by the owner during this plan. Keep impacts localized and weapon-specific; ordinary movement and rewards remain quiet. Misses and normal ranged Basics do not pause or shake.

## Painterly water and combat fluids

Forest Clearing water is a continuous shallow woodland stream, with an actual gravel bed, low irregular banks, a clear path ford and wider bends. Cool translucent water reveals the bed in shallows and darkens with authored depth; Golden lighting plus nearby scenery/character reflections and restrained moving highlights distinguish it from wet ground. Rock groups interrupt the current and collect sparse pale foam. Carry the channel beyond the playable view into woodland rather than ending it as a detached surface patch. Keep ordinary trees and shrubs rooted on the banks. Rain and footsteps produce soft, broken expanding crests and small splash arcs, with quiet wakes. Judge the still composition first, then moving highlights and contact effects at the normal gameplay camera. Golden lighting remains shared.

Physical hits against living enemies use moderate crimson droplets, directed splash arcs and brief stains without gore. Undead and blocked hits retain distinct feedback. Caster magic uses a tapered cyan liquid ribbon and a short impact splash; preserve the projectile silhouette and combat timing. Judge the complete scene during movement and combat, including muted sound, rather than isolated close-up effects.

Water must meet the landscape as a shallow transition: gradually visible gravel, a damp margin and banks with actual relief, without a colored cutout edge. Characters stand on the bed, with boots partly submerged and surface splashes tied to footfalls. Preserve readable moving reflections of adjacent rocks, trees, actors and local lighting. Water palette, level, depth, shoreline softness and reflection response are authored reusable surface controls; Clearing demonstrates them rather than defining a special rendering path.
