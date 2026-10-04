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

Use `"lighting": {}` to inherit the preset. Keep small placement, coverage and probe-volume differences beside the area definition. Full legacy lighting definitions are unsupported. Palette and family-wide changes belong in the preset. Honey-gold direct sun, richer autumn color, readable cool shade and deeper amber flame pools establish the same visual identity on every route. Exposure remains a player preference.

Area overrides support fog distance, sun placement/coverage and probe volume/settings; palette, light strength, environment and grading stay in the shared preset. `probes: false` disables static probes for a blockout. Labs use the same sun, hemisphere, environment and grading without area-sized scenery probes; the character gallery disables focus blur for inspection. Static probe coverage is derived when an area boundary is supplied.

## Autumn woodland review

Autumn color comes from foliage and terrain materials, not a global orange grade or higher exposure. Keep the shared Golden lighting preset and flame recipes unless matched views demonstrate a specific readability problem. Inspect actors, paths, ground contacts and amber refuges in one representative normal gameplay preview. Additional viewpoints and zoom extremes are optional targeted checks for a visible uncertainty or requested lighting audit.

Foliage exports and ground color changes invalidate static irradiance fingerprints. Reload the owned preview/cache after affected asset exports. When prepared-atlas work is requested, explicitly prepare affected areas with `npm run lighting:bake -- --area=homestead --surfaces=projected` or the same command with `--area=clearing` when that area is affected. Keep atlases private and update the existing bake index. Routine checks do not regenerate them.

## Local lights and probe coverage

`src/levels/local-lighting.ts` owns **campfire**, **torch** and **lantern** recipes: shared amber color (`#ffad55`), intensity, range, emitter height, flicker and shadow appearance. Campfire/torch/lantern strengths are 18/12/7 with ten/eight/seven-metre reach. All use native inverse-square falloff with a smooth range cutoff. Playable campfires inherit their recipe rather than weaker area intensity overrides. Flame props in `effects.fires` select a `role`; omitted roles use campfire. Placement and models remain area-owned. Existing intensity, emitterHeight and shadow values override the recipe; color and distance can also be overridden when needed. Gameplay healing/travel eligibility remains independent of the cosmetic light role.

The shared resolver derives the initial probe volume from the playable boundary, with a small margin, a lowest layer above ground, and spacing-based horizontal resolution. This works for offset and differently sized areas without copying Homestead's grid dimensions. The default vertical coverage assumes flat ground at Y=0; adjust it for raised terrain or interiors. Keep probes outside solid scenery and review light leakage near walls. Automatic coverage is a starting point, not a substitute for inspecting an enclosed space.

```json
"overrides": {
  "probes": { "auto": { "spacing": 4, "bottom": 0.7, "height": 4 } }
}
```

Explicit `position`, `size` and `resolution` overrides are available for deliberate volume placement. The resolver fills unspecified grid fields from the preset's automatic coverage. Static scenery is baked under the resolved sun/environment. Characters, portals, particles, animated local lights and hemisphere readability fill are excluded.

## Prepared bakes and resource ownership

Live authoring bakes new appearances automatically. Fingerprints cover rendered geometry/instances, transforms, material properties, source asset/texture bytes, procedural surface settings, resolved sun/environment/probes, surface mode and the pinned bake version. Names, enemies, rewards, arrivals, fog and grading do not invalidate a bake unless they actually alter rendered scenery. Asset exports require a fresh preview/cache reload before preparing bakes so the loaded art matches the source files.

After an area stabilizes:

```sh
npm run levels:dev -- --area=homestead
npm run lighting:bake -- --area=homestead --surfaces=projected
npm run levels:stop
```

The command uses the existing owned native WebGPU preview, exports half-float irradiance atlases under ignored `public/vendor/lighting/`, and updates `assets/lighting-bakes.json` with metadata references. `--area=all` prepares every registered area with probes under the one Golden preset. There are no lighting/profile selection flags. Surface comparison uses `--surfaces=authored`. Never run preparation concurrently with another preview owner or final build gate.

Gameplay loads a matching prepared atlas when available, otherwise it bakes live. Missing, stale or invalid prepared data never replaces the preceding scene with broken lighting; live preparation remains available and diagnostics report the prepared-data failure. Original assets and derived bakes remain private. Build staging copies only indexed private lighting outputs; superseded local bakes remain private and are not staged; source-only builds can omit it. Inspect inventory and applicable licensing before any distribution.

The r186 atlas readback/restore adapter is in `src/rendering/lighting-bake.ts`. Revalidate it on three.js upgrades and increment `lightingBakeVersion` when static shading or bake behavior changes. This invalidates incompatible outputs rather than trusting old bytes.

Each renderer has a global least-recently-used budget: **8 sky environments / 32 MiB**, **8 probe appearances / 16 MiB**. These limits do not grow with the number of areas. Leases protect committed lighting and in-flight candidates; inactive resources are disposed as budgets are exceeded. Active/in-flight resources can temporarily exceed a budget and are trimmed when released. These budgets cover cached lighting textures, not every render target, material or GPU binding in the application. Cancelled loads release their leases; failed preparation retains the current lighting.

## Visual reference and handoff

Maintain a small reference set: a normal gameplay view containing Golden sunlight, shaded scenery, the player lantern and a campfire, plus the character gallery and animation lab under the same preset. Earlier captures remain private historical evidence. When the first interior and enclosed dark area exist, add their fixed views to this set with deliberate area overrides of the same shared preset. Do not create production areas solely to fill a lighting checklist.

Review Erika, Goblin and Skeleton under matched camera, pose, exposure and graphics settings. Require readable faces/material detail, grounded shadows, preserved highlights and useful warm/cool separation. For ordinary lighting content changes, inspect one representative view and affected movement under normal settings. Zoom extremes, narrow windows, travel, failed preparation, repeated visits and prepared/live comparisons are targeted checks for changed loading/cache/bake behavior or a specific visual concern. Keep licensed-art captures private under `.local/`.

Finish with `npm run check` after closing the owned rendering session. Validate playable assets when their preparation changed. New or materially rewritten lighting tests follow the [test admission and review policy](DEVELOPMENT_REFERENCE.md#testing-during-the-prototype-phase); do not add per-area tests or a screenshot matrix by default.

## Player lantern

The personal lantern is enabled by default in browser and desktop play. The optional cage model and both amber emitters attach to Erika’s exported belt socket (with Hips as the legacy fallback), following movement and dodges across travel and encounter resets. The primary emitter uses the shared lantern recipe and a seven-metre cutoff. Its effective position is above and forward of the cage to illuminate torso and face. Short-range owner bounce on the opposite side of the torso uses 35% of the primary strength and a 2.8 m cutoff.

The cage handle is aligned to the belt socket and connected by a small hook, rather than a model-independent floating offset. Cage placement is independent of the effective chest emitter/bounce placement; preparation preserves those initial world positions and all recipe strengths/ranges. The same attachment class is used in gameplay and animation inspection.

Both personal emitters are unshadowed and excluded from static probe preparation. Campfires keep world shadows. Development inspection can disable the lantern with `?lantern=off` or the authoring checkbox; neither changes the shared preset. Fuel, equipment ownership and healing remain separate from cosmetic illumination.

## Sculpted dusk and atmosphere

All routes use the same lighting; there is no separate studio fill or camera-facing blanket fill. Woodland readability comes from the directional key, restrained hemisphere light, environment response and static irradiance; these contributions should be reviewed separately before changing their ownership. Do not remove reflections merely to darken diffuse illumination.

The preset authors distance fog through `background`, `fogNear` and `fogFar`, and grading through `grade`. The Atmosphere slider adjusts fog distance. Ray marching, light shafts, reduced-resolution volume buffers and bounded mist pockets are retired; moving smoke, particles and flame lights remain excluded from static bakes.

Graphics offers **Shadow Quality**, **Particle Effects** and an independent **Atmospheric particles** switch. High/Medium/Low sun maps are 2048/2048/1024 square; local flame maps are 1024/512/256 square. Native PCF keeps grass as a receiver without casting blades. Camera-fitted sun coverage uses texel snapping and a padded depth range including static casters; quality presets change map sizes, retaining authored light intensity and softness. Particle pool capacity is 100/75/50 percent, continuous emission is 100/75/55 percent and weather rate is 60/40/24 per second. Combat burst counts and timing remain unchanged. Atmospheric particles controls motes, smoke and embers, retaining flames, combat feedback, wind and water.

Fresh/reset settings use FSR Temporal Quality, sharpening 0.50, pixel ratio 1, High shadows/particles and Cinematic DOF. [Graphics settings](GRAPHICS.md#temporary-comparisons-and-persistence) owns the current save revision and quality-preset migration. Author with DOF Off when useful, then review with Cinematic and the shipping reconstruction settings. Temporary comparison URLs such as `?shadowQuality=low&particleQuality=low&atmosphericParticles=off&dof=off` do not persist through unrelated menu edits.

DOF runs after FSR reconstruction with aligned depth: Soft uses focus range 24 and bokeh 0.8; Cinematic uses 16 and 1.6. Both track the camera target. Review thin foliage while moving and at both zoom extremes; shader readiness alone does not establish visual quality.


## Agent lighting workflow


- All routes use the shared Golden lighting preset and small area overrides through `src/levels/lighting.ts`; see [lighting authoring](#one-preset-and-area-overrides). Do not duplicate scene lighting constants or apply outdoor moods globally.
- Local flame lights use the shared campfire/torch/lantern recipes. Gameplay campfire eligibility remains independent of cosmetic lighting.
- Prepare stable irradiance bakes explicitly with `npm run lighting:bake` in an owned native authoring session. Keep derived data private; routine checks/builds never regenerate it.
- Extend the small visual reference set when the first interior or enclosed dark area is introduced. Review character readability under the shared Golden preset when lighting changes.

## Interior cutaways

Graveyard Crypt is the first enclosed lighting reference. Its fixed roof cutaway uses area-owned `visibility: "lighting-only"` ceiling geometry on a dedicated lighting layer. Every shared sun/flame shadow camera includes that layer; gameplay beauty, AO and temporal passes retain their ordinary camera layers. Probe preparation clones the scenery and restores ceiling visibility to the default capture layer, without mutating the live scene. Instancing retains layer masks and lighting-only identity, and changing this role invalidates the lighting fingerprint.

The crypt inherits Golden colors and strengths. Enclosure, its area probe coverage, shared amber torches and the player lantern establish the indoor appearance; do not create an interior rendering graph or an alternate preset. Keep probe samples outside masonry and inspect sunlight/torch leakage. Its `center` view is the fixed private interior reference, alongside the existing woodland, character-gallery and animation-lab references. Prepare stable bakes explicitly in the owned authoring session with `npm run lighting:bake -- --area=graveyard-crypt`; derived atlases remain private.
