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

Homestead and Forest Clearing use approved A (Balanced honey-gold) as fixed Golden from `woodland-dusk`, labelled Woodland golden hour. Honey-gold direct sun and deeper amber flame pools have distinct roles. Full material saturation, readable cool hemisphere/environment fill, restrained diffuse bounce and light grading preserve richer autumn color without uniformly bright ground. Sun strength is balanced against local lights rather than raised indiscriminately. Warm sunlight and deep tree shadows retain contrast; the stronger shared amber flames remain distinct local sources. Gameplay does not randomly select a mood. Silver and `woodland-night` remain development comparisons for targeted inspection. `studio` provides neutral comparison lighting and has no outdoor mood variations. A future cave or interior profile should explicitly choose its sky/environment, key light, fill, fog and grading, and declare only the moods that make sense there. Do not apply outdoor moonlight or sunlight overrides globally.

Keep deliberate overrides beside the area definition. Modify the profile for changes intended across its whole family. A complete legacy lighting definition is still supported and opts out of profile moods; use this compatibility form for existing areas, not as the default for new authoring. Unknown profiles and invalid resolved settings fail level validation. Profile edits refresh the authoring scene while retaining its camera and selected mood.

`environment: false` and `probes: false` disable those sections in an override. Disabling probes can suit an early blockout or a profile that does not need local bounce. Exposure remains a player preference, independent of the profile; do not solve character visibility by raising scene exposure indiscriminately.

## Autumn woodland review

Autumn color comes from foliage and terrain materials, not a global orange grade or higher exposure. Keep the shared woodland lighting profiles and flame recipes unless matched views demonstrate a specific readability problem. Inspect actors, paths, ground contacts and amber refuges in one representative normal gameplay preview. Golden/silver comparisons, studio/night references and zoom extremes are optional targeted checks for a visible uncertainty or requested lighting audit.

Foliage exports and ground color changes invalidate static irradiance fingerprints. Reload the owned preview/cache after affected asset exports. When prepared-atlas work is requested, explicitly prepare affected areas with `npm run lighting:bake -- --area=homestead --lighting=all --surfaces=projected` or the same command with `--area=clearing` when that area is affected. Keep atlases private and update the existing bake index. Routine checks do not regenerate them.

## Local lights and probe coverage

`src/levels/local-lighting.ts` owns **campfire**, **torch** and **lantern** recipes: shared amber color (`#ffad55`), intensity, range, emitter height, flicker and shadow appearance. Campfire/torch/lantern strengths are 18/12/7 with ten/eight/seven-metre reach. All use native inverse-square falloff with a smooth range cutoff. Playable campfires inherit their recipe rather than weaker area intensity overrides. Flame props in `effects.fires` select a `role`; omitted roles use campfire. Placement and models remain area-owned. Existing intensity, emitterHeight and shadow values override the recipe; color and distance can also be overridden when needed. Gameplay healing/travel eligibility remains independent of the cosmetic light role.

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

The command uses the existing owned native WebGPU preview, exports half-float irradiance atlases under ignored `public/vendor/lighting/`, and updates `assets/lighting-bakes.json` with metadata references. `--area=all` prepares every registered area with probes; `--lighting=golden|silver|default` selects a dusk appearance; Moonlit/Deep/Misty night is available with `--profile=woodland-night`. Surface comparison uses `--surfaces=authored`. Never run preparation concurrently with another preview owner or final build gate.

Gameplay loads a matching prepared atlas when available, otherwise it bakes live. Missing, stale or invalid prepared data never replaces the preceding scene with broken lighting; live preparation remains available and diagnostics report the prepared-data failure. Original assets and derived bakes remain private. Build staging copies only indexed private lighting outputs; superseded local bakes remain private and are not staged; source-only builds can omit it. Inspect inventory and applicable licensing before any distribution.

The r186 atlas readback/restore adapter is in `src/rendering/lighting-bake.ts`. Revalidate it on three.js upgrades and increment `lightingBakeVersion` when static shading or bake behavior changes. This invalidates incompatible outputs rather than trusting old bytes.

Each renderer has a global least-recently-used budget: **8 sky environments / 32 MiB**, **8 probe appearances / 16 MiB**. These limits do not grow with the number of areas. Leases protect committed lighting and in-flight candidates; inactive resources are disposed as budgets are exceeded. Active/in-flight resources can temporarily exceed a budget and are trimmed when released. These budgets cover cached lighting textures, not every render target, material or GPU binding in the application. Cancelled loads release their leases; failed preparation retains the current lighting.

## Visual reference and handoff

Maintain a small reference set: a normal gameplay view containing Golden sunlight, shaded scenery, the player lantern and a campfire, plus the character gallery and animation lab under `studio`. Earlier Golden/Silver references remain private comparison evidence. When the first interior and enclosed dark area exist, add their fixed views to this set with their corresponding profiles. Do not create production areas solely to fill a lighting checklist.

Review the Paladin and Goblin under matched camera, pose, exposure and graphics settings. Require readable faces/material detail, grounded shadows, preserved highlights and useful warm/cool separation. Check movement, zoom extremes, narrow windows, travel, failed preparation and stable repeated visits. Compare prepared loading with live baking. For content changes, use the existing level capture tools and keep licensed-art images private under `.local/`.

Finish with playable asset validation and `npm run check`, after closing the owned rendering session. Avoid adding per-area tests or a large screenshot matrix: shared resolver/cache/bake regressions and a small representative browser pass protect the system.

## Candidate woodland directions

A matched local review compared Golden, Silver, a warm-key/neutral-sky direction and soft overcast. That review recommended warm neutral, with overcast as a quieter alternative; later readable-dark and richer Golden trials explore stronger light contrast instead. These two alternatives remain comparison experiments, not default profile changes. The approved A reference and fixed Golden baseline above supersede those earlier recommendations. Private captures and exact trial overrides live under `.local/lighting-system/comparison/`.

## Fixed-night baseline and player lantern

`woodland-night` is a fixed profile: it defaults to Moonlit on entry and never randomly selects a daytime look. Deep night and Misty night are authoring variants. The playable areas use approved fixed Golden; Moonlit remains the readable-dark comparison. Neither profile randomly changes its entry appearance. Neutral Studio remains fixed. In the authoring preview, choose **Profile → Woodland night**, then the light variant. The **Lantern** checkbox controls a personal warm light and optional cage model attached to the Paladin's Hips bone. It follows movement and dodges, has a seven-metre range, and is excluded from static probe bakes. It uses the shared lantern strength/color without a weaker player-only override. The effective emitter sits above and forward of the cage to reach the torso and face rather than concentrating illumination at the belt. A second amber point approximates owner bounce on the opposite side of the torso, with 35% of the primary strength and a 2.8 m cutoff, so turning does not make the owner a black silhouette. Both emitters follow the rig and are excluded from static bakes. They remain unshadowed to preserve owner readability; campfires keep their world shadows. Fuel, equipment ownership and healing are outside this lighting prototype.

The personal lantern is enabled by default in normal browser and desktop play, including production builds. Development comparisons can disable it with `?lantern=off` or the authoring checkbox. It remains attached across area travel and encounter resets.

A normal development play URL can use `/?profile=woodland-night&lighting=moonlit`; `dark` and `misty` select the other variants. Moonlit/Deep/Misty night are development comparisons with approved fixed Golden as the gameplay baseline.

`npm run lighting:bake -- --area=all --profile=woodland-night --lighting=all` prepares the three night variants for each area. The moving personal lantern is never baked into their illumination. Private matched captures and the rig/movement/travel checks are in `.local/lighting-system/night-lantern/`.

## Sculpted dusk and atmosphere

Gameplay and level authoring have no camera-facing blanket fill. Studio retains deliberate comparison lights. Woodland readability comes from the directional key, restrained hemisphere light, environment response and static irradiance; these contributions should be reviewed separately before changing their ownership. Do not remove reflections merely to darken diffuse illumination.

Profiles author distance fog through `background`, `fogNear` and `fogFar`, and grading through `grade`. The Atmosphere slider adjusts fog distance. Ray marching, light shafts, reduced-resolution volume buffers and bounded mist pockets are retired; moving smoke, particles and flame lights remain excluded from static bakes.

Graphics offers **Shadow Quality**, **Particle Effects** and an independent **Atmospheric particles** switch. High/Medium/Low sun maps are 2048/2048/1024 square; local flame maps are 1024/512/256 square. Native PCF keeps grass as a receiver without casting blades. Camera-fitted sun coverage uses texel snapping and a padded depth range including static casters; quality presets change map sizes, retaining authored light intensity and softness. Particle pool capacity is 100/75/50 percent, continuous emission is 100/75/55 percent and weather rate is 60/40/24 per second. Combat burst counts and timing remain unchanged. Atmospheric particles controls motes, smoke and embers, retaining flames, combat feedback, wind and water.

Fresh/reset settings use FSR Temporal Balanced, sharpening 0.50, pixel ratio 1, High shadows/particles and Cinematic DOF. Settings revision 5 retains the migration that maps old High/Low quality to High/Low shadows and particles without resetting other applicable preferences. Author with DOF Off when useful, then review with Cinematic and the shipping reconstruction settings. Temporary comparison URLs such as `?shadowQuality=low&particleQuality=low&atmosphericParticles=off&dof=off` do not persist through unrelated menu edits.

DOF runs after FSR reconstruction with aligned depth: Soft uses focus range 24 and bokeh 0.8; Cinematic uses 16 and 1.6. Both track the camera target. Review thin foliage while moving and at both zoom extremes; shader readiness alone does not establish visual quality.
