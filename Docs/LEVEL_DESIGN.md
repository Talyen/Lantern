# Level design and rapid visual authoring

Lantern uses stable, authored encounter areas with constrained procedural decoration. The same area builder, assets, lighting and renderer serve gameplay and the local authoring preview. No public deployment is part of this workflow.

## Area standard

One standard stage spans **2 viewport widths × 2 viewport heights** of ground coverage at a 1920 × 1080 canvas and the calibrated default gameplay zoom. This is four screens of ground, not two screens total. The initial calibration uses zoom 1.45 and the fixed 45-degree isometric camera: **33.103 × 26.334 m**, measured along the camera's ground-plane right/forward axes. One screen is 16.552 × 13.167 m. The envelope is rotated 45 degrees relative to world X/Z.

`npm run levels:calibrate` intersects reference camera corner rays with Y=0 and prints an envelope for new definitions. Copy the result when deliberately creating a new size standard. Dimensions are saved in scene data; browser resizing, scroll zoom and future camera edits never resize existing stages. Forest Clearing uses this standard envelope, a woodland approach and one guarded camp; the old circular clearing has been replaced.

Use metres, Y-up, ground at Y=0, yaw in radians, positive explicit scale, and stable IDs. A 4 m decorative apron surrounds the design envelope. It is scenery, not additional traversable space. A flat terrain backdrop may extend beyond that apron to cover the allowed camera views; navigation and prop placement remain bounded by the area and decorative apron. Keep ordinary areas mostly flat; explicit movement trials may use shared rendered/collision surface triangles for small slopes and steps. Use banks, cliffs and ruins around the playable space for larger elevation. Terrain asset exports happen separately from placement iterations.

Each area needs a landmark, readable combat space, a clear approach and exit, and a decorative perimeter. Compose from one representative gameplay-camera view at normal scale. Other positions, zooms and viewport sizes are targeted tools when a visible concern warrants them. Avoid foreground objects concealing actors, weapon contact or gate openings. Small areas should look deliberate, not uniformly filled.

## Definitions and ownership

Definitions live in `src/levels/areas/` as version-1 JSON, typed by `src/levels/types.ts`. The registry discovers them. `src/levels/builder.ts` owns rendered area instances; simulation consumes only numeric spawns/boundaries. The builder retains shared GLB/catalog resources across area replacement and releases area-owned meshes, instancing buffers, lights and effects.

- **Envelope:** fixed world dimensions, yaw, apron and reference projection.
- **Layout:** player/enemy spawn and circle or counterclockwise convex-polygon boundary.
- **Props:** stable ID, asset or primitive, transform, shadow policy and foliage role. Mark ground surfaces `terrain:true`; other new-area scenery must stay outside reserved regions. Primitive sizes are `[width,height,depth]` for boxes, `[topRadius,bottomRadius,height,segments]` for cylinders, `[radius]` for faceted rocks and `[width,height,depth]` for a simple canvas A-frame tent (double-sided). Optional `height` retains legacy model-height normalization. Prefer explicit scale for new assets. Optional height normalization centers the asset and places its bottom at the authored position before placement yaw/scale; rotation must not shift an off-center asset away from its collision proxy.
- **Lighting:** choose a shared profile and narrow overrides using [lighting authoring](LIGHTING.md). Complete legacy definitions remain supported. Resolved fields include background/fog, hemisphere, directional sun, optional procedural `environment` (sky/horizon/ground, broad sun radiance, intensity and yaw rotation), camera-side `fill`, `saturation`, and `probes` (world center/size, integer XYZ resolution, intensity, additional bounces). Graphics quality controls do not replace authored colors/fog. Probes capture static scenery on preparation and reuse unchanged appearances; keep their lowest layer above the terrain and out of solid scenery. Sky reflections remain available independently of the visible backdrop. Changes to rendered scenery or bake lighting invalidate probes; gameplay-only changes retain them; cancelled changes retain the previous lighting.
- **Effects:** water and local braziers; static composition belongs to area data.
- **Reserved regions:** circular combat, arrival and route exclusions. Build complex clear routes from overlapping regions.
- **Scatter:** seeded primitive decoration; bounded attempts can yield fewer than the requested count. `excludedIds` removes generated objects. An explicit prop with a generated ID replaces it. Decoration stays inside the walk boundary and outside reserved regions, gate triggers and automatic 2 m arrival clearances.
- **Grass carpets:** optional `grass` patches use `id`, `center: [x,z]`, `radii: [x,z]` (positive metres, at most 20), `yaw` (radians) and `density` (positive blades/m², at most 400). Overlapping ellipses merge rather than doubling density; irregular feathering thins their edges. Homestead uses four broad woodland patches at 200 blades/m², capped at 40,000 blades per area. Roots are seeded independently of scatter, exclude reserved/gate space, collision footprints and strongly worn soil, and render in 4 m cells. The short flat-ground grass uses the shared paused wind clock, receives lighting/shadows and stays outside static irradiance capture. Legacy grass and small pebble scatter have been removed from all areas; larger authored rocks remain.
- **Views:** entrance, center, exit, review-1 and review-2 ground targets. Overview is computed separately.

Props do not automatically become colliders or navigation obstacles. Optional `traversal.obstacles` defines explicit box proxies with world position, full size and yaw. Optional `traversal.surfaces` defines shared rendered/collision triangles for slopes. Keep proxies aligned with their art and spawns/routes clear; optional art does not change gameplay geometry. The numeric boundary generates the base floor. Optional `effects.portals` defines generic cosmetic portals (position, yaw, width, height), not gate travel. See [library trials](LIBRARY_TRIALS.md) for the movement adapter and comparison URLs.

Repeated compatible static primitives and opaque asset meshes are instanced. Skins, wind, transparency and native LOD ownership remain separate; catalog LODs are updated from the gameplay camera. Tiny decoration does not cast shadows by default. Use one main sun shadow light; Homestead and Clearing also use shadowed campfire point lights. The lighting pass currently prioritizes quality; shadowed point lights require six captures. Sun coverage follows the visible ground and raised scenery with texel-snapped positioning. Share materials and keep accent lights, foliage overlap and full-screen effects restrained. Baked static detail is an optional asset-preparation task, not a requirement for every iteration.

Use `npm run levels:find -- --query pine` for a compact private catalog lookup with IDs, bounds and conversion warnings. Standalone assets use `/vendor/...` URLs. Wider library assets use catalog IDs. Run `npm run levels:assets` explicitly to add referenced catalog IDs to build selection; it retains existing selections. `npm run levels:check` reports missing selections and catalog entries. Optional absent art is reported; structural validation remains usable in asset-free CI.

## Entrances, exits and travel

Encounter areas have one primary entrance, one primary exit and optional branch gates. A destination area may set `terminal: true` to omit the primary exit and return through its entrance. Safe areas (`kind: "safe"`) may omit gates and the enemy spawn. Gate positions are authored; there are no mandatory compass sides. Use a 3 m opening and 2 m-deep trigger by default. Yaw defines the trigger's forward axis: `[sin(yaw), cos(yaw)]` in X/Z. Place the destination arrival at least 2 m inside its walkable boundary and face inward. Reserve the arrival and approach for movement; exclude small decoration and keep large scenery outside the opening.

Links name a destination area and gate. New entries use that gate's arrival transform while retaining character health and session enemy/drop state. A short fade pauses input while content loads. Arrival triggers cannot immediately send the player back before they leave the trigger. One area is active at a time; shared assets remain cached. Victory permits walking to an exit; defeat offers Return Home with restored health. Inactive areas retain enemy health/defeat and uncollected scroll drops during the session; application restart refreshes them. Enemy return timers are deferred.

Forest Clearing is the default starting area; its player spawn is halfway between the camp and the Homestead path. Explicit area URLs override startup. Homestead is a safe area: a compact dusk woodland camp inside the standard envelope, with natural scenery that can later be cleared for building. No empty house plot is reserved. Healing campfires restore 3% of maximum health per gameplay second within 3 m, capped at full health. A living enemy within 10 m of the fire, or pursuing/returning anywhere in its area, blocks healing, interaction and travel. The same rule disables unsafe travel destinations, using retained inactive encounter state or the initial spawn. Interactive `campfires` reference a fire effect, destination name and clear arrival transform; entering their 3 m radius discovers them. Only Homestead starts unlocked; approaching the clearing camp fire discovers it. Existing saved discoveries survive, and never bypass safety. E opens Travel and lists discovered fires in other areas. `portalArrival` reserves the paired return portal's home position; keep it and the nearby arrival space clear. Fire effects can author `emitterHeight` and `intensity` for ground campfires rather than elevated braziers. Primitive `surface: "woodland"` uses the original local soil texture with three rotated/offset world-space samples and smooth, static TSL noise for soil/moss variation. Optional `patches` author worn ground directly in that material: `center: [x,z]` and positive `radius` are in world metres, `color` is a six-digit hex tint, and `strength` is 0–1. Patches blend in list order with irregular feathered edges; they add no geometry or collision. Homestead uses overlapping worn-soil patches around its fire and arrival point.

Homestead and Forest Clearing connect through a reciprocal woodland path. The blockout remains a developer-only area with valid return links; it is not part of the normal outing.

Forest Clearing has one Goblin guarding a chest and rest/travel fire. Its 6 m notice radius requires line of sight; damaging it also alerts it. Beyond 10 m from its camp or player it returns through navigation, remains a campfire threat, and recovers to full health on arrival. Movement, dodging and missed attacks do not alert distant guards. Both actors have 100 maximum health; player contacts deal 50 damage and goblin contacts deal 20.

Typed `chests` reference a placed asset through `prop`, an interaction `position`, and a positive integer `scrolls` reward. The clearing chest offers two Scrolls of Return after the guard dies, using E within 1.8 m. Its open lid and remaining reward survive area travel during the session; inventory overflow remains available for later collection. Application restart refreshes the chest and encounter. Chest lid animation remains presentation-owned and excluded from static mesh batching.

## Woodland color composition

Homestead and Forest Clearing use the weathered autumn palette in [Art Direction](ART_DIRECTION.md). Keep copper/rust/ochre in broad foliage clusters, darker olive in supporting masses, and burgundy sparse. Stable colors belong to the prepared asset family, not random per-instance or per-face tinting. Keep soil warm brown, use subdued autumn staining near tree edges, and preserve quiet paths and combat spaces. Color iterations retain transforms, collision, reserved regions and scatter seeds/counts. Technical blockout and movement trials retain their diagnostic colors.

## Fast iteration

Prerequisites: the project's Node version, installed npm dependencies, `agent-browser` on PATH with its browser installed, and Python 3 with Pillow (already required by asset preparation). Use `brew install agent-browser` and `agent-browser install` if needed. Prepared character and Mixamo art are required for playable verification.

1. `npm run levels:dev -- --area=clearing` starts an owned loopback Vite server and isolated headless browser. The preview requires native WebGPU and defaults to FSR Temporal; there is no reconstruction or backend fallback. `--renderer=webgpu` is a compatibility argument; other backends are rejected.
2. Edit area JSON. Vite hot updates preserve renderer/cache, preview camera and graphics settings. Content changes reset temporal history and encounter pose. Frozen previews retain the selected target and zoom. No production build, browser restart or Blender export is needed.
3. Use Area/View, Play/Freeze and Guides controls, or `npm run levels:capture -- --area=clearing`.
4. Inspect one resulting view locally. Correct a visible concern in the same session. `--view ID` selects another view; `--all` explicitly creates the full contact sheet.
5. Use the fast sanity gate after the area stabilizes and one relevant interaction when behavior changed. Measurements and broad smoke flows are optional targeted checks.
6. `npm run levels:stop` closes only the owned browser/server. Close rendering sessions after review to release the agent GPU slot.

The development-only route is `/?author=levels&area=<id>`. Scene-code changes may reload the page; data edits are the optimized path. Invalid definitions preserve the last valid scene and report the area/object. Invalid JSON syntax also triggers Vite's error overlay. Superseded asynchronous loads are discarded and released. Readiness means the committed revision has loaded and rendered, not merely that requests started.

`window.lanternAuthoring` exposes diagnostics, area selection, viewpoint/zoom, freeze/play, overlays, clean captures and frame settling. It exists only in development authoring sessions. The CLI uses this bridge through agent-browser rather than screen coordinates. No object gizmos, undo or scene-saving endpoint is included.

Captures freeze simulation, effects and actor pose, reset temporal history, then render settling frames. Clean captures omit authoring/game HUD; overview includes guides. Files under ignored `.local/level-design/<area>/<runtime-prefix>-<revision>/` include the requested view and manifest; explicit `--all` adds all gameplay views, overview and contact sheet with content hash, settings, asset readiness, errors and timings. A batch fails if its revision, content hash or runtime identity changes. Missing art labels it **incomplete**. Capturing does not constitute visual approval: the designer must inspect the images.

Warm targets: under 2 s from data update to readiness and under 5 s per clean view. Measure actual results, separate cold asset startup, and report misses rather than hiding them with longer timeouts. The full six-view batch takes longer than one capture. A readiness error or missing character must be resolved before claiming playable/visual completion.

## AI designer checklist and brief

Read this guide and the area brief before editing. Inspect current data. Change one coherent concern and inspect one representative preview; a capture is optional. Compare the result with the intended impression using [the visual review criteria](ART_DIRECTION.md#visual-review), alongside actor visibility, combat ground, entrances/exits, shadows, foreground silhouettes and perimeter seams. Normal gameplay scale is the default. Inspect another view/zoom only when a specific concern needs it. Record the visible outcome briefly; separate review notes, smoke matrices and performance reports are not routine completion requirements.

When using a reference, identify the specific lesson in composition, lighting, material, or motion and how it serves this area's intent. Keep reference use compatible with licensing restrictions; never submit licensed Synty content or local renders to ImageGen.

Copy this brief into an area's task or private review notes:

- **Area / intent:** name and purpose; standard envelope or approved exception.
- **Intended impression:** the player's immediate perception.
- **Composition decision:** landmark framing, visual balance, and where detail concentrates.
- **Distinctive feature:** the memorable choice that gives this area character.
- **Restraint:** what stays quiet to support that choice.
- **Landmark:** focal object, silhouette and location.
- **Encounter:** maneuvering space, enemy spawn and readable contact area.
- **Routes / gates:** approach, exit, optional branch; protected arrival regions.
- **Palette / surfaces:** limited palette and approved asset families.
- **Lighting:** main direction, warm/cool accents, fog and shadow priorities.
- **Acceptance views:** entrance, center, exit and two risk-focused viewpoints.
- **Performance / review:** target preset and machine; latest capture revision; retain/revise rationale.

Licensed sources, GLBs, generated bakes and captures remain private under `.local/` or `public/vendor/`. Never submit Synty models/textures/renders to ImageGen. Original text-prompted textures can follow the existing local projection pipeline. Preview/capture/measurement do not modify build selections, export art, or publish anything.

Environment palette, material treatment, golden/silver entry selection and local surface preparation follow [the art direction](ART_DIRECTION.md).
