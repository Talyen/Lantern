# Lighting authoring

Lighting is shared game infrastructure. New areas select an art profile instead of copying a complete set of lighting numbers. The renderer keeps native WebGPU, the shared visual pipeline, material-aware indirect-light AO, native shadow filtering and color management consistent across every route.

## Profiles and area overrides

`src/levels/lighting-profiles.ts` owns reusable looks. `src/levels/lighting.ts` is the single resolver used by gameplay, authoring, probe preparation and comparison labs. Resolution order is **profile → supported mood → area overrides**. Overrides merge the named lighting sections; vector arrays replace whole vectors. Resolving never modifies a shared profile.

```json
"lighting": {
  "profile": "woodland-dusk",
  "overrides": {
    "fogFar": 70,
    "sun": { "shadowExtent": 30 }
  }
}
```

Homestead and Forest Clearing share `woodland-dusk`. Golden and silver are variations of that profile, chosen on successful entry; failed entries, retries and area hot updates retain the committed mood. `studio` provides neutral comparison lighting and has no outdoor mood variations. A future cave or interior profile should explicitly choose its sky/environment, key light, fill, fog and grading, and declare only the moods that make sense there. Do not apply outdoor moonlight or sunlight overrides globally.

Keep deliberate overrides beside the area definition. Modify the profile for changes intended across its whole family. A complete legacy lighting definition is still supported and opts out of profile moods; use this compatibility form for existing areas, not as the default for new authoring. Unknown profiles and invalid resolved settings fail level validation. Profile edits refresh the authoring scene while retaining its camera and selected mood.

`environment: false` and `probes: false` disable those sections in an override. Disabling probes can suit an early blockout or a profile that does not need local bounce. Exposure remains a player preference, independent of the profile; do not solve character visibility by raising scene exposure indiscriminately.

## Autumn woodland review

Autumn color comes from foliage and terrain materials, not a global orange grade or higher exposure. Keep the shared woodland lighting profiles and flame recipes unless matched views demonstrate a specific readability problem. Review both golden and silver at minimum, normal and maximum gameplay zoom, plus a studio material comparison; check that actors, paths, ground contacts and amber refuges remain distinct. Also inspect the night profile when present, without changing its authored mood behavior.

Foliage exports and ground color changes invalidate static irradiance fingerprints. Reload the owned preview/cache after asset exports, then explicitly prepare Homestead and Clearing with `npm run lighting:bake -- --area=homestead --lighting=all --surfaces=projected` and the same command with `--area=clearing`. Keep atlases private and update the existing bake index. Routine checks do not regenerate them.

## Local lights and probe coverage

`src/levels/local-lighting.ts` owns **campfire**, **torch** and **lantern** recipes: color, intensity, range, emitter height, flicker and shadow appearance. Flame props in `effects.fires` select a `role`; omitted roles use campfire. Placement and models remain area-owned. Existing intensity, emitterHeight and shadow values override the recipe; color and distance can also be overridden when needed. Gameplay healing/travel eligibility remains independent of the cosmetic light role.

Woodland profiles derive the initial probe volume from the playable boundary, with a small margin, a lowest layer above ground, and spacing-based horizontal resolution. This works for offset and differently sized areas without copying Homestead's grid dimensions. The default vertical coverage assumes flat ground at Y=0; adjust it for raised terrain or interiors. Keep probes outside solid scenery and review light leakage near walls. Automatic coverage is a starting point, not a substitute for inspecting an enclosed space.

```json
"overrides": {
  "probes": { "auto": { "spacing": 4, "bottom": 0.7, "height": 4 } }
}
```

Explicit `position`, `size` and `resolution` overrides are available for deliberate volume placement. The resolver fills unspecified grid fields from the profile's automatic coverage. Static scenery is baked under the resolved sun/environment. Characters, portals, particles, animated local lights, camera-side fill and hemisphere readability fill are excluded.

## Prepared bakes and resource ownership

Live authoring bakes new appearances automatically. Fingerprints cover rendered geometry/instances, transforms, material properties, source asset/texture bytes, procedural surface settings, resolved sun/environment/probes, surface mode and the pinned bake version. Names, enemies, rewards, arrivals, fog, grading and fill do not invalidate a bake unless they actually alter rendered scenery. Asset exports require a fresh preview/cache reload before preparing bakes so the loaded art matches the source files.

After an area stabilizes:

```sh
npm run levels:dev -- --area=homestead
npm run lighting:bake -- --area=homestead --lighting=all --surfaces=projected
```

The command uses the existing owned native WebGPU preview, exports half-float irradiance atlases under ignored `public/vendor/lighting/`, and updates `assets/lighting-bakes.json` with metadata references. `--area=all` prepares every registered area with probes; `--lighting=golden|silver|default` selects one supported appearance. Surface comparison uses `--surfaces=authored`. Never run preparation concurrently with another preview owner or final build gate.

Gameplay loads a matching prepared atlas when available, otherwise it bakes live. Missing, stale or invalid prepared data never replaces the preceding scene with broken lighting; live preparation remains available and diagnostics report the prepared-data failure. Original assets and derived bakes remain private. Build staging copies only indexed private lighting outputs; superseded local bakes remain private and are not staged; source-only builds can omit it. Inspect inventory and applicable licensing before any distribution.

The r186 atlas readback/restore adapter is in `src/rendering/lighting-bake.ts`. Revalidate it on three.js upgrades and increment `lightingBakeVersion` when static shading or bake behavior changes. This invalidates incompatible outputs rather than trusting old bytes.

Each renderer has a global least-recently-used budget: **8 sky environments / 32 MiB**, **8 probe appearances / 16 MiB**. These limits do not grow with the number of areas. Leases protect committed lighting and in-flight candidates; inactive resources are disposed as budgets are exceeded. Active/in-flight resources can temporarily exceed a budget and are trimmed when released. These budgets cover cached lighting textures, not every render target, material or GPU binding in the application. Cancelled loads release their leases; failed preparation retains the current lighting.

## Visual reference and handoff

Maintain a small reference set: Homestead's center/fire and shaded review views in golden and silver, plus the character gallery and animation lab under `studio`. When the first interior and enclosed dark area exist, add their fixed views to this set with their corresponding profiles. Do not create production areas solely to fill a lighting checklist.

Review the Paladin and Goblin under matched camera, pose, exposure and graphics settings. Require readable faces/material detail, grounded shadows, preserved highlights and useful warm/cool separation. Check movement, zoom extremes, narrow windows, travel, failed preparation and stable repeated visits. Compare prepared loading with live baking. For content changes, use the existing level capture tools and keep licensed-art images private under `.local/`.

Finish with playable asset validation and `npm run check`, after closing the owned rendering session. Avoid adding per-area tests or a large screenshot matrix: shared resolver/cache/bake regressions and a small representative browser pass protect the system.

## Candidate woodland directions

A matched local review compared Golden, Silver, a warm-key/neutral-sky direction and soft overcast. Warm neutral is the current recommended fixed woodland direction; overcast is a quieter alternative. These two alternatives remain comparison experiments, not default profile changes. Choose the scene art direction before deciding whether any entry variation or day/night behavior is useful. Private captures and exact trial overrides live under `.local/lighting-system/comparison/`.

## Fixed-night and player lantern prototype

`woodland-night` is a fixed profile: it defaults to Moonlit on entry and never randomly selects a daytime look. Deep night and Misty night are authoring variants. Woodland dusk keeps its existing entry variations; neutral Studio remains fixed. In the authoring preview, choose **Profile → Woodland night**, then the light variant. The **Lantern** checkbox controls a personal warm light and optional cage model attached to the Paladin's Hips bone. It follows movement and dodges, has a six-metre range, and is excluded from static probe bakes. It is currently an unshadowed personal light to preserve owner readability; campfires keep their world shadows. Fuel, equipment ownership and healing are outside this lighting prototype.

The personal lantern is enabled by default in normal browser and desktop play, including production builds. Development comparisons can disable it with `?lantern=off` or the authoring checkbox. It remains attached across area travel and encounter resets.

A normal development play URL can use `/?profile=woodland-night&lighting=moonlit`; `dark` and `misty` select the other variants. The night-profile overrides are developer trials. An authored area can adopt the fixed-night profile in its lighting recipe when the art direction is selected. The default area profiles remain woodland dusk while the trials are reviewed.

`npm run lighting:bake -- --area=all --profile=woodland-night --lighting=all` prepares the three night variants for each area. The moving personal lantern is never baked into their illumination. Private matched captures and the rig/movement/travel checks are in `.local/lighting-system/night-lantern/`.

## Sculpted dusk and atmosphere

Gameplay and level authoring have no camera-facing blanket fill. Studio retains deliberate comparison lights. Woodland readability comes from the directional key, restrained hemisphere light, environment response and static irradiance; these contributions should be reviewed separately before changing their ownership. Do not remove reflections merely to darken diffuse illumination.

Profiles author distance fog through `background`, `fogNear` and `fogFar`, and grading through `grade`. The Atmosphere slider adjusts fog distance. Ray marching, light shafts, reduced-resolution volume buffers and bounded mist pockets are retired; moving smoke, particles and flame lights remain excluded from static bakes.

Graphics offers **Shadow Quality**, **Particle Effects** and an independent **Atmospheric particles** switch. High/Medium/Low sun maps are 2048/2048/1024 square; local flame maps are 1024/512/256 square. Native PCF keeps grass as a receiver without casting blades. Camera-fitted sun coverage uses texel snapping and a padded depth range including static casters; quality presets change map sizes, retaining authored light intensity and softness. Particle pool capacity is 100/75/50 percent, continuous emission is 100/75/55 percent and weather rate is 60/40/24 per second. Combat burst counts and timing remain unchanged. Atmospheric particles controls motes, smoke and embers, retaining flames, combat feedback, wind and water.

Fresh/reset settings use FSR Temporal Balanced, sharpening 0.50, pixel ratio 1, High shadows/particles and Cinematic DOF. Settings revision 5 retains the migration that maps old High/Low quality to High/Low shadows and particles without resetting other applicable preferences. Author with DOF Off when useful, then review with Cinematic and the shipping reconstruction settings. Temporary comparison URLs such as `?shadowQuality=low&particleQuality=low&atmosphericParticles=off&dof=off` do not persist through unrelated menu edits.

DOF runs after FSR reconstruction with aligned depth: Soft uses focus range 24 and bokeh 0.8; Cinematic uses 16 and 1.6. Both track the camera target. Review thin foliage while moving and at both zoom extremes; shader readiness alone does not establish visual quality.
