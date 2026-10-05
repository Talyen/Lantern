# Lighting authoring

Lighting is shared game infrastructure. Every route inherits the single approved Golden lighting preset. The renderer keeps native WebGPU, the shared visual pipeline, material-aware indirect-light AO, native shadow filtering and color management consistent across every route.

## One preset and area overrides

`src/levels/lighting-preset.ts` owns the sole approved Golden (balanced honey-gold) look. Gameplay, authoring, the character gallery and animation lab use it through `src/levels/lighting.ts`. There are no alternate profiles, moods, entry randomization, lighting URL switches or authoring preset controls. Resolution is **shared preset → intentional area overrides**; resolving never modifies the shared preset.

```json
"lighting": {
  "overrides": {
    "fogFar": 70,
    "sun": { "shadowExtent": 30 }
  }
}
```

Use `"lighting": {}` to inherit the preset. Keep small shadow-coverage and probe-volume differences beside the area definition. Sun direction belongs only to the shared preset, so outdoor travel retains a consistent light direction. Full legacy lighting definitions are unsupported. Palette and family-wide changes belong in the preset. Honey-gold direct sun, richer autumn color, readable cool shade and deeper amber flame pools establish the same visual identity on every route. Exposure remains a player preference.

Area overrides support fog distance, sun coverage and probe volume/settings; palette, light strength, environment and grading stay in the shared preset. `probes: false` disables static probes for a blockout. Labs use the same sun, hemisphere, environment and grading without area-sized scenery probes; the character gallery disables focus blur for inspection. Static probe coverage is derived when an area boundary is supplied.

## Autumn woodland review

Autumn color comes from foliage and terrain materials, not a global orange grade or higher exposure. Keep the shared Golden lighting preset and flame recipes unless matched views demonstrate a specific readability problem. Inspect actors, paths, ground contacts and amber refuges in one representative normal gameplay preview. Additional viewpoints and zoom extremes are optional targeted checks for a visible uncertainty or requested lighting audit.

Foliage exports and ground color changes invalidate static irradiance fingerprints. Reload the owned preview/cache after affected asset exports. When prepared-atlas work is requested, explicitly prepare affected areas with `npm run lighting:bake -- --area=homestead --surfaces=projected` or the same command with `--area=clearing` when that area is affected. Keep atlases private and update the existing bake index. Routine checks do not regenerate them.

## Local lights and probe coverage

`src/levels/local-lighting.ts` owns **campfire**, **torch** and **lantern** recipes: shared amber color (`#ffad55`), intensity, range, emitter height, flicker and shadow appearance. Campfire/torch/lantern strengths are 18/12/7 with ten/eight/seven-metre reach. All use native inverse-square falloff with a smooth range cutoff. Playable campfires inherit their recipe rather than weaker area intensity overrides. Flame props in `effects.fires` select a `role`; omitted roles use campfire. Placement and models remain area-owned. Existing intensity, emitterHeight and shadow values override the recipe; color and distance can also be overridden when needed. Gameplay healing/travel eligibility remains independent of the cosmetic light role.

Stationary world flame lights reuse native shadow depth until a relevant caster enters, moves/deforms, changes visibility/material/geometry, or leaves their range. Brightness flicker does not invalidate depth. Skinning uses conservative transformed bind-sphere bounds; vegetation retains its authored expanded bounds. Unknown node deformation keeps shadows live conservatively. Explicit shadow layers preserve cutaway ceilings across shared beauty/AO/reflection cameras; the adapter and actual cube-face submission counters are pinned to three.js r186. Shadow Quality changes invalidate the maps. Development graphics diagnostics report per-light refreshes, cube-face renders, tracked casters and the last invalidation reason.

The shared resolver derives the initial probe volume from the playable boundary, with a small margin, a lowest layer above ground, and spacing-based horizontal resolution. This works for offset and differently sized areas without copying Homestead's grid dimensions. The default vertical coverage assumes flat ground at Y=0; adjust it for raised terrain or interiors. Keep probes outside solid scenery and review light leakage near walls. Automatic coverage is a starting point, not a substitute for inspecting an enclosed space.

```json
"overrides": {
  "probes": { "auto": { "spacing": 4, "bottom": 0.7, "height": 4 } }
}
```

Explicit `position`, `size` and `resolution` overrides are available for deliberate volume placement. The resolver fills unspecified grid fields from the preset's automatic coverage. Static scenery has separate daylight and fixed-flame captures. Daylight includes the resolved sun/environment and the generated sky background, so unobstructed capture rays see the sky rather than black. Flame captures use a black background, no sun/environment, and occluded fixed world emitters at recipe strength. Visible emissive flame surfaces, characters, portals, particles, the moving personal lantern and hemisphere readability fill are excluded.

Within probe coverage, captured irradiance owns diffuse ambient light. A one-metre exterior collar blends complementarily back to global hemisphere/environment diffuse. Environment specular, metallic multiscattering and clearcoat reflections remain native and independent of that diffuse weight. Probe coordinates use geometric normals with a 0.15 m offset cap (also bounded by half the smallest cell spacing); shading normals still evaluate SH. The shared gain is 1.0. The regular grid still interpolates across neighbouring samples: this is not visibility-aware wall interpolation. Inspect remaining leakage near thin walls instead of hiding it with AO.

## Prepared bakes and resource ownership

Normal play requires prepared atlases and never starts a live GPU bake. Development serving and production staging validate source bytes and current preparation inputs on the asset host. Prepare both ruined and restored Homestead appearances (`--shelter-restored` for the latter). Missing/stale preparation produces an actionable startup error. Live authoring bakes new appearances automatically. Fingerprints cover rendered geometry/instances, transforms, material properties, source asset/texture bytes, procedural surface settings, resolved sun/environment/probes, surface mode and the pinned bake version. World matrices are fingerprinted at the 32-bit precision uploaded to WebGPU, so insignificant Safari/Chromium rotation rounding does not reject identical prepared lighting. Geometry and source bytes retain their complete hashes. Names, enemies, rewards, arrivals, fog and grading do not invalidate a bake unless they actually alter rendered scenery. Asset exports require a fresh preview/cache reload before preparing bakes so the loaded art matches the source files.

After an area stabilizes:

```sh
npm run levels:dev -- --area=homestead
npm run lighting:bake -- --area=homestead --surfaces=projected
npm run levels:stop
```

The command uses the existing owned native WebGPU preview, exports paired half-float irradiance components under ignored `public/vendor/lighting/`, and updates `assets/lighting-bakes.json` with metadata references. `--area=all` visits registered areas; use explicit playable-area commands while Blockout retains its ground-receiver preparation issue. There are no lighting/profile selection flags. Surface comparison uses `--surfaces=authored`. Never run preparation concurrently with another preview owner or final build gate.

Normal gameplay requires a matching prepared atlas. Missing, stale or invalid prepared data produces an actionable preparation error and never replaces the preceding scene with broken lighting. Live preparation remains available only in level authoring, and diagnostics report prepared-data failures. Live preparation waits for each eight-probe GPU batch to complete before submitting the next; a JavaScript yield alone does not bound native graphics work. Startup and travel also wait for completed destination submissions before revealing the world. Original assets and derived bakes remain private. Build staging copies only indexed private lighting outputs; superseded local bakes remain private and are not staged; source-only builds can omit it. Inspect inventory and applicable licensing before any distribution.

Bake version 9 requires named daylight and optional flame components, a fixed-emitter count, matching dimensions and finite signed SH coefficients. Legacy single-component data is incompatible. The r186 atlas readback/restore adapter is in `src/rendering/lighting-bake.ts`. Revalidate it on three.js upgrades and increment `lightingBakeVersion` when static shading or bake behavior changes. This invalidates incompatible outputs rather than trusting old bytes.

Each renderer has a global least-recently-used budget: **8 sky environments / 32 MiB**, **8 probe appearances / 16 MiB**. These limits do not grow with the number of areas. Leases protect committed lighting and in-flight candidates; inactive resources are disposed as budgets are exceeded. Active/in-flight resources can temporarily exceed a budget and are trimmed when released. Sky accounting includes the retained original sky and PMREM; probe accounting includes both immutable CPU components and each leased owner’s combined CPU/GPU texture. These budgets cover cached lighting resources, not every render target, material or GPU binding in the application. Cancelled loads release their leases; failed preparation retains the current lighting.

Each committed lighting owner has one stable combined atlas: `daylight SH + worldFirelightGain × flame SH`. The shared gain is `0.65 + 0.5 × Firelight`, matching average direct world-fire strength. Signed coefficients mix before irradiance evaluation/clamping. Coalesced Firelight edits update the atlas; ordinary frames do not mix or upload coefficients. Direct flames retain flicker, and daylight/personal emitters remain independent. Prepared components are immutable and owners never mutate another scene’s atlas. Diagnostics expose component count and CPU mixing time; that time is not an isolated GPU-upload measurement.

## Visual reference and handoff

Maintain a small reference set: a normal gameplay view containing Golden sunlight, shaded scenery, the player lantern and a campfire, plus the character gallery and animation lab under the same preset. Graveyard Crypt’s `center` view is the first [enclosed reference](#interior-cutaways). Earlier captures remain private historical evidence. Add future references only when an authored area introduces a distinct lighting concern; keep deliberate area overrides of the same shared preset. Do not create production areas solely to fill a lighting checklist.

Review Erika, Goblin and Skeleton under matched camera, pose, exposure and graphics settings. Require readable faces/material detail, grounded shadows, preserved highlights and useful warm/cool separation. For ordinary lighting content changes, inspect one representative view and affected movement under normal settings. Zoom extremes, narrow windows, travel, failed preparation, repeated visits and prepared/live comparisons are targeted checks for changed loading/cache/bake behavior or a specific visual concern. Keep licensed-art captures private under `.local/`.

Finish with `npm run check` after closing the owned rendering session. Validate playable assets when their preparation changed. New or materially rewritten lighting tests follow the [test admission and review policy](DEVELOPMENT_REFERENCE.md#testing-during-the-prototype-phase); do not add per-area tests or a screenshot matrix by default.

## Player lantern

The personal lantern is enabled by default in browser and desktop play. The optional cage model and both amber emitters attach to Erika’s exported belt socket (with Hips as the legacy fallback), following movement and dodges across travel and encounter resets. The primary emitter uses the shared lantern recipe and a seven-metre cutoff. Its effective position is above and forward of the cage to illuminate torso and face. Short-range owner bounce on the opposite side of the torso uses 35% of the primary strength and a 2.8 m cutoff.

The cage handle is aligned to the belt socket and connected by a small hook, rather than a model-independent floating offset. Cage placement is independent of the effective chest emitter/bounce placement; preparation preserves those initial world positions and all recipe strengths/ranges. The same attachment class is used in gameplay and animation inspection.

Both personal emitters are unshadowed and excluded from static probe preparation. Campfires keep world shadows. Development inspection can disable the lantern with `?lantern=off` or the authoring checkbox; neither changes the shared preset. Fuel, equipment ownership and healing remain separate from cosmetic illumination.

## Weather and static preparation

Outdoor showers share the adventure schedule described in [level authoring](LEVEL_DESIGN.md#authored-precipitation-and-shallow-water). Rain never changes the Golden sun, sky, fog or indirect-light strengths. Ground rain wetness is a live uniform; probe captures set it to zero and restore it afterward, including failed captures. Transient precipitation and saved weather are excluded from bake identity. Changing the shared sun requires explicit re-preparation; Homestead no longer overrides its direction.

## Sculpted dusk and atmosphere

All routes use the same lighting; there is no separate studio fill or camera-facing blanket fill. Woodland readability comes from the directional key, restrained hemisphere light, environment response and static irradiance; these contributions should be reviewed separately before changing their ownership. Do not remove reflections merely to darken diffuse illumination.

The preset authors distance fog through `background`, `fogNear` and `fogFar`, and grading through `grade`. The Atmosphere slider adjusts fog distance. Ray marching, light shafts, reduced-resolution volume buffers and bounded mist pockets are retired; moving smoke, particles and flame lights remain excluded from static bakes.

Graphics offers **Shadow Quality**, **Particle Effects** and an independent **Atmospheric particles** switch. High/Medium/Low sun maps are 2048/2048/1024 square; local flame maps are 1024/512/256 square. Native PCF keeps grass as a receiver without casting blades. Camera-fitted sun coverage uses half-metre projection-size buckets, texel snapping and a padded depth range including light-space-overlapping static casters and moved scenery; lowered ground remains inside receiver coverage. Quality presets change map sizes, retaining authored light intensity and softness. Particle pool capacity is 100/75/50 percent, continuous emission is 100/75/55 percent and weather rate is 60/40/24 per second. Combat burst counts and timing remain unchanged. Atmospheric particles controls motes, smoke and embers, retaining flames, combat feedback, wind and water.

Fresh/reset settings use FSR Temporal Quality, sharpening 0.50, native physical output, High shadows/particles and Soft DOF. [Graphics settings](GRAPHICS.md#temporary-comparisons-and-persistence) owns the current save revision and quality-preset migration. Author with DOF Off when useful, then review with Soft and the shipping reconstruction settings. Temporary comparison URLs such as `?shadowQuality=low&particleQuality=low&atmosphericParticles=off&dof=off` do not persist through unrelated menu edits.

DOF runs after FSR reconstruction with aligned depth: far-only Soft uses focus range 10 and bokeh 0.65; Cinematic uses 6 and 1.15. Both track the camera target. Review thin foliage while moving and at both zoom extremes; shader readiness alone does not establish visual quality.


## Ambient occlusion

Screen AO uses the existing beauty depth, half scene resolution, eight samples and depth-derived normals. Beauty writes one optional indirect-diffuse attachment; AO subtracts only its occluded portion before outlines and FSR. Direct sun/flames, emission and specular highlights remain intact, and authored material cavity/AO is applied once. Transparent water and particles contribute no receiver term; their beauty coverage still attenuates the underlying diffuse contribution. AO Off allocates no AO attachment or processing, and enabling AO adds no world geometry pass. The shared contact radius is 0.35 m with thickness 0.3 m. Positive strength values have the same sampling cost; select strength visually rather than as a performance tier.

## Agent lighting workflow


- All routes use the shared Golden lighting preset and small area overrides through `src/levels/lighting.ts`; see [lighting authoring](#one-preset-and-area-overrides). Do not duplicate scene lighting constants or apply outdoor moods globally.
- Local flame lights use the shared campfire/torch/lantern recipes. Gameplay campfire eligibility remains independent of cosmetic lighting.
- Prepare stable irradiance bakes explicitly with `npm run lighting:bake` in an owned native authoring session. Keep derived data private; routine checks/builds never regenerate it.
- Use Graveyard Crypt’s fixed `center` view for affected interior work; extend the small reference set when a future area introduces a distinct lighting concern. Review character readability under the shared Golden preset when lighting changes.

## Interior cutaways

Graveyard Crypt is the first enclosed lighting reference. Its fixed roof cutaway uses area-owned `visibility: "lighting-only"` ceiling geometry on a dedicated lighting layer. Every shared sun/flame shadow camera includes that layer; gameplay beauty, AO and temporal passes retain their ordinary camera layers. Probe preparation clones the scenery and restores ceiling visibility to the default capture layer, without mutating the live scene. Instancing retains layer masks and lighting-only identity, and changing this role invalidates the lighting fingerprint.

The crypt inherits Golden colors and strengths. Enclosure, its area probe coverage, shared amber torches and the player lantern establish the indoor appearance; do not create an interior rendering graph or an alternate preset. Keep probe samples outside masonry and inspect sunlight/torch leakage. Its `center` view is the fixed private interior reference, alongside the existing woodland, character-gallery and animation-lab references. Prepare stable bakes explicitly in the owned authoring session with `npm run lighting:bake -- --area=graveyard-crypt`; derived atlases remain private.
