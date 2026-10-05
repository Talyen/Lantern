# Private asset preparation

Use an [owned task worktree](DEVELOPMENT.md#working-alongside-other-agents) and read [private resource rules](DEVELOPMENT_REFERENCE.md#private-assets-and-resource-use) before preparing assets. Preparation is explicit and never part of routine checks.

## Visual asset review

Use the [Asset Review Lab](ASSET_REVIEW.md) to approve individual prepared appearances, deny asset families, or request separate deletion cleanup. Unreviewed art can ship; denied or deletion-marked used appearances and selected visual roots cannot. Completed deletion exclusions prevent import/export resurrection while preserving private sources.

## Private asset workflow

Gameplay audio preparation, private source provenance, optimized output and event coverage are owned by [gameplay sound](AUDIO.md). `npm run audio:prepare` is explicit; routine checks and builds only validate/stage selected prepared files.

See [character preview](CHARACTERS.md) for the complete model gallery, `npm run assets:export-characters`, and `npm run characters:capture`.

Synty/Mixamo sources, receipts, catalog metadata and hashes stay under `.local/`. Exported vendor art stays under `public/vendor/`, entirely ignored. Never send Synty files, textures or renders to ImageGen. Original text-prompted surfaces in `assets/textures/` are projected/baked locally.

The original iron anvil is prepared with `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/original/smithing-anvil.mjs`. Its [geometry recipe](../scripts/assets/original/smithing-anvil.mjs) uses no licensed inputs, writes the private `lantern-original:model:iron-anvil` library entry and never approves it. Completed deletion exclusions prevent regeneration.

### Required playable character and motions

The playable roster is owner-supplied **B1 Adventurer** (player, 1.72 m), **Goblin D Shareyko** (Clearing enemies, 1.45 m), and Synty Generic **Skeleton 01** (graveyard enemies, 1.8 m), with Mixamo clips independently baked to each rig. `assets/playable-characters.json` owns their source IDs, model URLs and heights. Each has its own compatible catalog and base combat motions plus directional/weapon actions and a player-only dodge; selected clips load lazily. The [animation review](ANIMATIONS.md) owns source selection and visual evidence. Scenery and the broader character gallery remain optional.

1. Keep the acquired character FBXs and motion sources under `.local/animation-packs/mixamo/`. If sources are missing, sign into Mixamo in Safari, select X Bot for motion acquisition, then run `npm run assets:download-mixamo` and paste the generated `.local/mixamo-download-console.js` into the Mixamo console. `--prepare-only` regenerates the helper; `--motions-only` refreshes only animations at 60 fps with no keyframe reduction; `--downloads` changes the receipt directory. Tokens stay in Safari and must never be logged or committed. Old 30 fps completion records do not satisfy a 60 fps acquisition. Preserve the previous private library before an upgrade, then verify the replacement with `python3 scripts/assets/mixamo/verify-mixamo-library.py --complete --fps 60`. Refresh private source hashes while retaining stable clip IDs before rebaking. Acquisition sidecars retain legacy pack aliases so fresh indexing preserves those IDs; keep superseded sources under a private `Archives/` directory, which source discovery excludes.
2. In a task worktree, first clone the needed private sources with `npm run agent:sources -- --sources animation-packs,synty-library`. Run `npm run assets:export-character` with Blender installed locally. `--blender PATH` selects another executable. This prepares the manifest-selected B1/Goblin/Skeleton weapon profiles and all 17 previous comparison sources, sampled at 60 fps with horizontal root travel removed and reviewed timing cooked into the clips. `--motions-only` reuses authored models, repacks compatible motions and refreshes gallery references. The full source index stays private at `.local/animation-packs/mixamo/converted-source-catalog.json`; retired Viking playback exports are unnecessary.
3. Preparation preserves each character’s original authored textures at source resolution and packs its compatible default motions into the playable model. `--player-only` limits preparation to B1 and `--skeleton-only` to Skeleton 01; `--motions-only` updates motions without re-exporting authored models.
B1 preparation retains her complete authored outfit, facial controls and skinned lantern. Her 52-bone A-pose rig is aligned to the T-pose motion sources before independent baking. Geometry, UVs and source-resolution textures remain authored. See [protagonist appearance](PROTAGONISTS.md) for source identity, preparation and acceptance.

4. Run `npm run assets:check -- --playable`, then one relevant browser flow when accepting changed playable art. Gameplay loads the equipped weapon profile directly. Use the development animation lab for comparisons.

Retired Paladin palettes, original ground/painted-rock studies and their preparation recipes are privately archived with hashes under `.local/animation-packs/Archives/repo-cleanup/` in the cleanup task. Task cleanup retains them under main’s `.local/agent-archives/repo-cleanup/animation-packs/Archives/repo-cleanup/`. Existing licensed source catalogs and private exports are preserved. These experiments are absent from active manifests and game builds.

New characters start with an Axe; Axe, Sword, Shield, Bow and Staff select coherent compatible motion profiles. Goblin retains Orc Idle with an Axe walking stride, compact Axe attack/reaction and falling-back death. Exact source IDs, trims and markers belong to `assets/motion-profiles.json`; titles are never selection keys. Parent normalization preserves authored rig transforms/materials. Full finger mapping, calibrated gait contacts and authored grips remain subject to the visual review in [animations](ANIMATIONS.md).

Run `python3 scripts/assets/mixamo/verify-mixamo-library.py --complete` when checking full catalog coverage and source hashes. Full-catalog verification is explicit, not a routine handoff step.

### Lossless surface channel packing

Run `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/pack.mjs` explicitly after preparing environment surfaces; `--only pine,rock,chest` limits families. It preserves color, normal RGB, roughness and metalness bytes and folds height into metallic/roughness red, eligibility into its alpha, and cavity into normal alpha. Version-3 material metadata selects those channels; legacy versions 1/2 remain supported. The separate relief texture is no longer a runtime dependency. Source GLBs and relief PNGs are hash-archived under `.local/synty-library/Archives/packed-surfaces/`; task cleanup preserves them. Routine checks/builds never repack art.

### GPU-compressed scenery

The optional chest, tent and pine preparation trial embeds UASTC KTX2 textures, with original dimensions, full mip chains and unchanged 16× material filtering. The default prepared art retains its original PNG textures: the local trial reduced logical GPU allocations, but concurrent work in other projects prevented a reliable system-memory comparison. Compressed candidates remain private and opt-in pending controlled acceptance. The stock pinned three.js decoder is bundled by Vite; the prototype permits generated JavaScript for its local scripts while retaining CSP resource restrictions and Electron isolation. No renderer fallback is introduced.

Preparation is explicit: `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/compress.mjs --encoder /absolute/path/to/toktx`. Optional `--only chest,tent,pine` narrows the selected families. KTX-Software's local encoder uses UASTC quality 3 and lossless Zstandard level 9, with two threads. Original prepared GLBs are hash-archived under `.local/synty-library/Archives/compressed-surfaces/originals/`; task cleanup preserves that source archive. Re-exporting surfaces restores ordinary PNG GLBs until compression is explicitly run again. Checks/builds never encode textures.

### Optional scenery and surface studies

The Clearing approach/camp uses an area-specific collection in `areaAssets.clearing` and shared local field recipes in `areaPreparation.clearing` of the environment manifest. Prepare only that collection with `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/environment.mjs --area clearing`, then losslessly pack it with the same wrapper and `pack.mjs --area clearing`. `--only pine,rock,...` can narrow either operation. Outputs stay under ignored `public/vendor/synty/environment/clearing/`; other areas retain their existing prepared surfaces. Reload the owned preview and explicitly prepare Clearing's projected lighting bake after exports. Existing text-prompted sources are preserved; geometry, faceted normals and articulated hierarchy remain unchanged.

The default Clearing/Homestead material treatment uses normal maps and spatial roughness/cavity fields on the prepared environment set. Texture Depth controls POM, defaults to On and preserves existing saved preferences. Fixed 16× material filtering has no menu control. Character maps remain authored.

Prepare the tracked original ground data explicitly with `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/environment.mjs --ground-fields`. Prepare selected scenery with the same wrapper and `environment.mjs [--only pine,rock,...]`. This generates embedded tangent normals and private `*-surface.png` sidecars beside the GLBs; their version-2 material metadata owns URL/depth; opaque RGB stores height/cavity/POM eligibility, with roughness retained in the embedded map and staging includes that dependency. The exporter keeps original color sources, uses 2048-pixel bakes for prominent families and 1024 for supporting props, and prepares conservative rock bevels/pine shaping. Missing relief sidecars retain baked color/normal surfaces and report incomplete art. Reload the owned preview after exporting; do not rebake through routine checks or builds.

Ground-field preparation also produces matching `stone-v1` and `stone-v2` normal/surface pairs under tracked `assets/textures/environment/ground/`. Primitive stone materials use them with the original color sources through the same three local projections, preserving facet geometry while adding mineral relief, roughness and cavity response. The 0.45 projection scale and 0.055 m source relief belong to the preparation/runtime recipes; changing their physical scale requires re-preparing the fields. These original text-prompted derivatives contain no licensed input.


For the bounded weathered woodland study, open `/?author=levels&area=clearing&surfaces=showcase` in an owned preview, or choose **Woodland showcase** in the authoring Surfaces selector. This selects the existing `entrance` view; use Play to walk, fight and chop with the same gameplay runtime. Projected restores the current prepared surfaces. The option is development-only and does not change normal gameplay defaults.

Prepare its two private GLBs explicitly with `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/environment.mjs --showcase`. Recipes and placement/ground selection belong to [the environment manifest](../assets/textures/environment/manifest.json); original material sources and exact text-only prompts/hashes belong to [showcase sources](../assets/textures/environment/showcase/sources.json). Keep derived GLBs under ignored `public/vendor/synty/environment/showcase/`. Missing showcase exports report incomplete art and retain current prepared scenery. Reload the owned preview after rebaking; runtime ground layers and shader parameters participate in lighting fingerprints. No routine check regenerates these exports or lighting.

The default prepared woodland uses weathered autumn foliage and warm-brown soil; authored surfaces remain available in development authoring. The environment manifest owns per-asset foliage targets, value scales and shadow/olive retention. Run `node scripts/agents/run.mjs --resource heavy -- node scripts/assets/surfaces/environment.mjs --only pine,bush,fern` to rebake affected foliage locally. The exporter classifies original palette regions first, then recolors both foliage inputs while preserving geometry, alpha and hierarchy. Existing original PNGs and exact ImageGen prompts remain unchanged. Reload the owned preview before visual review and explicit lighting preparation; use the task workflow and automatic export/GPU resource leases.

Run `npm run assets:import` to regenerate the standalone chest and authored/painterly cliff rock from `.local/synty-library/sources/`. Use `--source PATH` to select another local Polygon Viking Realm asset root. Existing `/vendor/synty/chest.glb` and `/vendor/synty/art-lab/rock*.glb` URLs remain stable for area definitions and lighting fingerprints. Ground uses the tracked soil texture directly; no ground GLB export is needed. Missing optional scenery does not prevent the encounter from running.

`npm run assets:import-library` imports the wider private Synty library. `npm run assets:verify-library` performs its full coverage/geometry check. These remain explicit import operations. The importer needs Blender, Unity CLI/Unity 6000.6.2f1, and Python with Pillow. Use `--dry-run` for inventory only, `--pack` to select packs, and `--reuse-inventory` only to resume the last staged snapshot. Source FBX is preferred; Unity exports prefab/material/skin/LOD metadata and the ASCII FBX fallback converts locally through three.js. Downloaded scripts are not executed. Native Unity `.asset` meshes include collision/LOD geometry. The Alpine terrain height field exports as base geometry at up to 513×513 vertices; painted terrain layers remain archived for later integration. Pack-filtered imports retain other packs in the catalog. Unsupported engine resources and material approximations remain visible in private coverage/catalog records. Register production library IDs in `assets/library-selection.json`; staging includes their converted dependency closure. Prepared lighting uses its explicit bake index. Other vendor staging follows playable models and catalog clips, area references, the environment manifest and their file dependencies. The gallery, alternate Paladin palettes, unused exports and conversion sidecars are excluded; both labs are development-only. `.local/build-inventory.json` records included vendor paths, sizes and total bytes; source archives are rejected. Review inventory and applicable vendor terms before any future build distribution. Source publication does not publish `dist/` or private vendor files.

## Ultimate study assets

The development [Ultimate study](ANIMATIONS.md#ultimate-motion-and-synty-effects-study) uses the acquired Mixamo and Synty Particle FX library. In an owned task, clone `animation-packs,synty-library` with `agent:sources`, then run `npm run assets:export-character -- --player-only --motions-only`. The player manifest's `comparison` list selects six source-timed clips; they are written to a separate private `study.json`, excluded from the gameplay catalog and build dependency closure. Sword profiles also prepare the three adopted mastery clips and their explicit contacts; compatible Bow variants are authored from the joined shot at runtime.

Run `npm run assets:prepare-particle-study` explicitly with Python/PyYAML available. It reads the five selected Unity prefabs locally, resolves referenced Synty textures/materials and the already-converted spark mesh, and writes recipes and hashed dependencies under ignored `public/vendor/synty/particle-study/`. It never executes vendor scripts or modifies original art. Missing sources/conversions fail preparation; checks and builds never run the exporter. The exporter retains source recipe metadata for provenance. The complete ability study uses the extracted Synty art in Lantern-authored effects; it does not attempt to replay Unity ParticleSystem modules. The exporter also writes a bounded `ability-effects/arrow-rain.json` recipe containing only the adopted dust/spark references. Gameplay staging includes that recipe and its two private art dependencies; the broader study catalog remains excluded.

## Material recipe ownership and import validation

`assets/material-recipes.json` is shared by Python field preparation and runtime shading. Family heights are in metres; bake sampling scales and runtime scales are explicit. Preserve authored source images, facets, pivots and hierarchy. Ground fields retain a checked recipe snapshot in `assets/textures/environment/ground/recipe.json`; changes to physical heights, bake scales or stone fields require `environment.mjs --ground-fields`. A new prepared export records its family and recipe version; the runtime can identify older prepared families from their canonical manifest URL. Author material differences through family field profiles rather than unrelated renderer constants.

`environment.mjs` validates every generated GLB before reporting completion. `npm run materials:check` checks existing prepared collections without exporting: map presence, sampled UV coverage, coordinate-frame agreement, tangent layout and image/atlas references. Missing optional private files are reported separately. Standard and prepared runtime imports report incorrect color spaces and incomplete maps through material diagnostics. Run the native material probe for adapter/dependency changes as described in [material calibration](ART_DIRECTION.md#material-calibration-and-durable-checks).

## Asterfall weapon comparison

The locally supplied `Asterfall_Armory_11_Weapons.zip` contains eleven original Blender-authored static weapon GLBs. In an owned task run `npm run assets:import-asterfall`; `--archive PATH` selects another copy. The importer verifies delivered hashes and self-contained GLB bounds before writing, preserves the archive, source, scripts and provenance under ignored `.local/animation-packs/asterfall-armory/`, and writes a separate preview catalog under ignored `public/vendor/asterfall/`. Bundled scripts are preserved without execution. No conversion, recoloring or remeshing is performed.

Open `/?lab=animations&study=weapons` for matched player poses with current weapon art in A and Asterfall in B. **Compare weapons** reapplies the matched preset using A's equipment and motion. Each lane has independent **Weapon art** and **Weapon size** controls; Gameplay size uses current equipment lengths, while Authored size exposes the new source proportions. Gathering motions still use the existing gathering tools. Preview selection changes no gameplay equipment or saves.

Open `/?lab=weapons` for the full standalone gallery with a shared camera, Golden lighting and matched framing. Matched size uses gameplay lengths for supported families or the selected counterpart's length; unmatched families retain authored dimensions. Current equipped art, the gathering Pickaxe and Viking Hammer are the default counterparts; unmatched families remain explicitly unmatched, with other prepared weapon variants selectable. Both routes use the shared native WebGPU pipeline and are development-only. Asterfall exports are excluded from production staging. Keep source files and comparison captures private; adopting these models for gameplay requires a separate selection.

## Ashen Veil environment library

The locally supplied `Ashen_Veil_Environment_Essentials.zip` contributes 37 original, metre-scale assets: 14 woodland pieces/variants, seven graveyard pieces, eight crypt modules and eight props. Run `npm run assets:import-ashen-veil` in an owned task; `--archive PATH` selects another copy. The importer validates every supplied SHA-256 hash, parses all 40 GLBs with the pinned three.js loader, checks finite geometry/transforms and verifies individual triangle counts, Y-up bounds and all 41 placement/articulation pivots against the manifest. It does not execute bundled scripts.

The shared scene catalog registers `ashen-veil:model:<hyphenated-name>` IDs, with prepared models under ignored `public/vendor/synty/library/models/ashen-veil/`. The existing directory name is a loader/staging convention; these models are original Ashen Veil art, separate from the Synty packs. Find them with `npm run levels:find -- --query ashen-veil --limit 40`, or narrow the query to `ashen-veil:model:crypt` or `ashen-veil:model:forest`. Other catalog packs are retained. No gameplay placements or build selections are added by import.

Area `Placement` entries can use `asset: { libraryId: 'ashen-veil:model:forest-oak-gold' }` with metre positions, ordinary yaw and `scale: [1, 1, 1]`. Keep the authored placement root rather than recentering its nested meshes. Before shipping a placed asset, add its ID to the explicit gameplay selection through `npm run levels:assets` and author appropriate collision/navigation and interaction data. The pack supplies visual geometry, not authored collision meshes, LODs, wind, gameplay interactions or dynamic fire. Use Lantern's shared Golden lighting and local flame recipe when adopting the brazier.

Crypt floors have a 2 m grid and their origin on the walk surface; their thickness extends below zero. Walls/doorways are 2 m long and 3 m high; corners use the wall-centerline junction. Stairs ascend along exported −Z. Preserve the named `lid_hinge`, `Lid`, `Gate_L_Z_hinge` and `Gate_R_Z_hinge` children when authoring chest, sarcophagus and gate motion. The source README owns hinge rotations and modular joining details.

The source GLBs use a descriptive string in node `extras.pivot`. Pinned three.js r186 interprets that key as a numeric exporter pivot and changes container/child transforms. Preparation renames only those strings to `placement_pivot_description`; it preserves binary geometry, materials and hierarchy. Private `lantern-import.json` records source/prepared hashes and the metadata adjustments. Runtime materials continue through the existing shared node-material adapter, retaining two-sided surfaces and emissive strength.

The archive, unmodified source GLBs, Blender libraries, builders, manifest, supplied previews and validation reports remain under ignored `.local/synty-library/ashen-veil-environment/`; completed task cleanup retains them in that task's source archive. Three prepared demo assemblies remain under ignored `public/vendor/ashen-veil/reference-scenes/` as `demo_autumn_woodland.glb`, `demo_outdoor_graveyard.glb` and `demo_crypt_dungeon.glb`. They are references rather than live areas, and neither the new library assets nor demos enter production staging until explicitly selected/referenced. Re-running the importer replaces only its prepared pack files and corresponding catalog IDs.

## Autumn Atlas and Hearthsteel libraries

The owner-supplied compact archives contain **24 Autumn Atlas botanical assets** and **11 Hearthsteel weapons**. In an owned task, run `npm run assets:import-generated`; its defaults read `Autumn_Atlas_Botanical_Expansion_Compact.zip` and `Hearthsteel_Traditional_11_Weapons_Compact.zip` from Downloads. `--downloads PATH` selects another directory; `--pack autumn-atlas` or `--pack hearthsteel` limits preparation. Rowan is excluded from this importer and the project.

The [importer](../scripts/assets/generated-packs/import.mjs) verifies every delivered model, source, script, manifest, preview and report against the compact SHA-256 receipt before writing. Compact editions omit raw PNG presentation/QA images mentioned by the full manifests; the JPEGs and model files are present. Bundled scripts are preserved without execution. The [validator](../scripts/assets/generated-packs/validate.mjs) parses all 36 GLBs with pinned three.js, checks decoded indices, finite attributes/transforms, unit normals, exact triangle/primitive counts, metre-scale Y-up bounds and placement/grip origins, and confirms authored PBR factors, vertex colors and double-sided flags survive node-material conversion. The 24 botanicals total 86,902 triangles; the 11 weapons total 37,098.

| Pack | Library IDs | Prepared models |
| --- | --- | --- |
| Autumn Atlas | `autumn-atlas:model:<hyphenated-source-id>`, e.g. `autumn-atlas:model:tree-copper-beech` | `public/vendor/synty/library/models/autumn-atlas/` |
| Hearthsteel | `hearthsteel:model:<weapon>`, e.g. `hearthsteel:model:sword` | `public/vendor/synty/library/models/hearthsteel/` |

These original models use the existing library directory convention and shared material adapter; they are separate from licensed Synty art. Find them with `npm run levels:find -- --query autumn-atlas --limit 30` or `npm run levels:find -- --query hearthsteel --limit 20`. They are ready for explicit later selection: import adds no gameplay placements or build selections, and preserves other catalog entries. The botanical demo remains a private reference at `public/vendor/autumn-atlas/reference-scenes/demo_amber_glade.glb`.

Keep the root at authored metre scale without another up-axis correction. Botanicals have ground-level pivots, opaque vertex colors and double-sided geometric leaves, with no textures. Weapons are static, grip-centred props: most extend along +Y; the bow fires along −X, crossbow along +Y, and shield face points +Z. The importer renames Hearthsteel's descriptive `extras.pivot` string to `placement_pivot_description` for r186, leaving binary geometry and materials unchanged. Author weapon attachment rotation/secondary grips and any bow/reload motion when adopting them. Botanicals need authored collision/navigation, wind, LODs and interactions as appropriate; these packs provide visual art only. Geometry/import checks do not establish scene composition or runtime performance.

Unmodified archives, editable Blender libraries, previews, scripts, source GLBs and hash/import reports stay under `.local/animation-packs/generated-packs/<pack>/`. Cleanup retains them under `.local/agent-archives/<task>/animation-packs/generated-packs/`. `npm run assets:import-generated -- --verify` validates preserved archives, prepared outputs and library references without writing; on main it also searches the completed-task archives. Before shipping, explicitly select used IDs through `levels:assets` and author the appropriate scene/gameplay data.

## Additional generated environment and lootable libraries

The six owner-supplied archives add **65 standalone assets** to the existing private scene library. Import them together in an owned task:

```sh
npm run assets:import-generated -- --pack ashen-veil-lights,full-autumn-trees,dungeon-tiles,gothic-lootables,hearthwood-furniture,outdoor-crypt-lootables
```

`--downloads PATH` selects another source directory. `--pack` accepts any distinct selection from the following table, the existing `autumn-atlas` and `hearthsteel` packs, and the [generated environment packs](#generated-village-interior-storytelling-water-and-terrain-packs) below. Omitting it still selects only Autumn Atlas and Hearthsteel.

| Pack ID | Downloads archive | Standalone assets |
| --- | --- | --- |
| `ashen-veil-lights` | `Ashen_Veil_Light_Source_Variants.zip` | 12 lights/fire props |
| `full-autumn-trees` | `full_autumn_trees.zip` | Six trees |
| `dungeon-tiles` | `dungeon_tile_expansion.zip` | 24 modules across Worn Cryptstone, Mossy Ruins and Dark Fortress |
| `gothic-lootables` | `Warm_Fantasy_Chests_Breakables.zip` | Four chests and six intact breakables |
| `hearthwood-furniture` | `Hearthwood_Racks_Furniture.zip` | Six racks/furniture props |
| `outdoor-crypt-lootables` | `Outdoor_Crypt_Lootables.zip` | Three outdoor and four crypt props |

Library IDs are `<pack>:model:<hyphenated-source-id>`, for example `full-autumn-trees:model:tree-copper-beech` and `gothic-lootables:model:chest-simple-wooden`. Find a pack with `npm run levels:find -- --query dungeon-tiles --limit 30`. Models live under ignored `public/vendor/synty/library/models/<pack>/`; that existing directory convention does not make these generated models licensed Synty art. Import preserves other packs and adds no gameplay placements or production selections.

The importer retains the unchanged ZIPs and all delivered Blender sources, GLBs, scripts, previews, manifests and QA reports under ignored `.local/animation-packs/generated-packs/<pack>/`. Bundled scripts are never executed. Cleanup retains these files under `.local/agent-archives/<task>/animation-packs/generated-packs/`. The Full Autumn forest and three dungeon demos are prepared under ignored `public/vendor/<pack>/reference-scenes/`, outside the placeable catalog. Hearthwood's four original Hearthsteel weapon references remain supporting source files rather than new library registrations.

Preparation validates all selected packs before exposing their models/catalog entries. It checks safe unique archive paths and exact model inventories, verifies supplied file receipts and current-file hashes from manifests/QA reports, and records every delivered file's import-time SHA-256 fingerprint. Dungeon Tiles supplies no current-file checksums; unsupplied hashes establish a retained import baseline, not independent delivery verification. Historical geometry/revision fingerprints remain private evidence rather than current-file receipts.

Pinned three.js decodes all 65 models, four demos and four supporting weapon references. Validation checks finite attributes/transforms, indexed geometry, unit normals, declared triangle/primitive counts and metre-scale Y-up bounds. Standalone origins and named articulation/emitter pivots are checked against their manifests; dungeon connector coordinates retain their source-to-glTF mapping. Material adaptation retains vertex colors, sidedness, PBR factors and emissive strength. Descriptive `extras.pivot` strings are renamed to `placement_pivot_description` for r186 compatibility; binary geometry, authored hierarchy and material data are preserved.

Run the read-only verification after import, or on main after task cleanup:

```sh
npm run assets:import-generated -- --pack ashen-veil-lights,full-autumn-trees,dungeon-tiles,gothic-lootables,hearthwood-furniture,outdoor-crypt-lootables --verify
```

It verifies preserved archives/extracted sources, prepared output hashes, decoded models and library metadata. Catalog records retain dimensions, placement conventions and relevant articulation, emitter and modular data for later adoption.

Use authored metre scale and placement roots without recentering. Dungeon floor thickness extends below the walk datum; wall/suspension light origins are attachment points rather than floor contact. Full Autumn uses single-sided closed geometric leaves. Preserve chest lids, doors, drawers, removable payloads and equipment children when adding interactions. Chests & Breakables contains intact states only. Light props supply static emissive geometry and emitter markers, with no runtime lights or animation; later placement uses [shared Golden lighting and local flame recipes](LIGHTING.md).

These are library-ready visual assets. Collision, navigation, wind, LODs, dynamic flames and opening/breaking gameplay remain explicit later adoption work. Appearance review belongs to the separate asset review tool; import checks do not establish visual quality, in-scene behavior or runtime performance. No gallery or review route is added by this preparation.

## Generated village, interior, storytelling, water and terrain packs

Five owner-supplied Downloads archives add **66 standalone assets** to the existing library and Asset Review Lab. Import in an owned task:

```sh
npm run assets:import-generated -- --pack sootward-village,blackthorn-interiors,silent-roads,stillwater-deepstone,hollowmere-terrain
```

| Pack ID | Downloads archive | Standalone assets |
| --- | --- | --- |
| `sootward-village` | `Sootward_Village_Structures.zip` | 18 village modules |
| `blackthorn-interiors` | `Blackthorn_Interior_Furnishings.zip` | 12 furnishings |
| `silent-roads` | `Silent_Roads_Storytelling_Props.zip` | 10 storytelling props |
| `stillwater-deepstone` | `Stillwater_Deepstone_Water_Underground.zip` | 12 water/underground modules |
| `hollowmere-terrain` | `Hollowmere_Dry_Terrain_Transitions.zip` | 14 dry terrain transitions |

Standalone IDs use `<pack>:model:<hyphenated-source-id>`, with GLBs under ignored `public/vendor/synty/library/models/<pack>/`. They appear automatically in the existing [Asset Review Lab](ASSET_REVIEW.md), initially unreviewed. Import adds no scene placements or build selections. The two Sootward assemblies, Stillwater/Deepstone assembly and Hollowmere forest-to-cave demo remain private reference scenes under `public/vendor/<pack>/reference-scenes/`, outside the placeable catalog.

The importer retains unchanged archives and every delivered Blender source, script, preview, manifest and QA report under `.local/animation-packs/generated-packs/<pack>/`; bundled scripts are never executed. Task cleanup preserves them in `.local/agent-archives/<task>/animation-packs/generated-packs/`. Supplied current GLB checksums are verified for Blackthorn and Silent Roads. The other three packs supply no current-file checksums; retained import fingerprints establish a baseline rather than independent delivery verification.

Pinned three.js decodes all 70 GLBs and checks declared standalone triangle/primitive counts, finite geometry, unit normals, authored roots, metre-scale Y-up bounds and node-material compatibility. Sootward socket coordinates and Hollowmere named anchors retain their source-to-glTF mapping. Preserve the authored roots: foundations, thresholds and water channels extend below their walk datums; roofs, tapestries and stalactites have attachment origins. Vertex colors, PBR factors, sidedness and hierarchy remain authored. Stillwater's separate `Water_Surface` child is optional opaque preview geometry requiring a production water treatment on later adoption. Collision, navigation and interactions remain later authoring work.

Verify preserved sources, prepared models and library registrations without writing, including on main after cleanup:

```sh
npm run assets:import-generated -- --pack sootward-village,blackthorn-interiors,silent-roads,stillwater-deepstone,hollowmere-terrain --verify
```

This preparation establishes library availability; appearance approval remains a separate review in the Asset Lab.

## Gothic weapon variants

Ten owner-supplied packs add 60 original static equipment variants to the shared library. Import them explicitly in an owned task:

```sh
npm run assets:import-generated -- --pack ashenforge-axe,ashenforge-mace,ashenforge-greathammer,gothic-bow,gothic-crossbow,gothic-staff,gothic-wand,gothic-sword,gothic-greatsword,sepulchral-shields
```

| Pack | Download archive | Variants |
| --- | --- | --- |
| `ashenforge-axe` | `Ashenforge_Gothic_Axe_6_Variants.zip` | 6 axes |
| `ashenforge-mace` | `Ashenforge_Gothic_Mace_6_Variants.zip` | 6 maces |
| `ashenforge-greathammer` | `Ashenforge_Gothic_Greathammer_6_Variants.zip` | 6 greathammers |
| `gothic-bow` | `Gothic_Bow_Variants.zip` | 6 bows |
| `gothic-crossbow` | `Gothic_Crossbow_Variants.zip` | 6 crossbows |
| `gothic-staff` | `Gothic_Earthbound_Staff_Variants.zip` | 6 staffs |
| `gothic-wand` | `Gothic_Earthbound_Wand_Variants.zip` | 6 wands |
| `gothic-sword` | `Gothic_Sword_Six_Variants.zip` | 6 swords |
| `gothic-greatsword` | `Gothic_Greatsword_Six_Variants.zip` | 6 greatswords |
| `sepulchral-shields` | `Sepulchral_Armory_Gothic_Shields.zip` | 6 shields |

The [weapon adapters](../scripts/assets/generated-packs/weapon-packs.mjs) retain source IDs as `<pack>:model:<hyphenated-source-id>`, with prepared GLBs under ignored `public/vendor/synty/library/models/<pack>/`. They appear automatically as unreviewed **Equipment** in [Asset Review](ASSET_REVIEW.md). Import adds no scene placements, gameplay equipment or build selections.

Pinned three.js decodes every model and checks declared triangle/primitive counts, finite attributes, unit normals, metre-scale Y-up bounds, identity grip roots and shared node-material compatibility. Authored geometry, materials and scale are preserved. String `extras.pivot` descriptions are renamed to `placement_pivot_description` because three.js reserves `pivot` for numeric offsets; the source GLBs remain unchanged. Catalog metadata retains the primary grip at the origin and supplied secondary-hand targets: greathammers use Y = 0.45 m and greatswords use Y = -0.20 m. Rig-specific attachment orientation, hand poses and bow/reload animation remain later gameplay authoring work.

The importer verifies all supplied SHA-256 receipts for bows, crossbows, swords, greatswords and shields. Ashenforge, staff and wand deliveries have no supplied current-file checksums; import-time fingerprints establish their retained baseline. Unchanged ZIPs, Blender sources, scripts, manifests, QA and presentation files stay private under `.local/animation-packs/generated-packs/<pack>/`, then `.local/agent-archives/<task>/animation-packs/generated-packs/` after cleanup. Bundled scripts are retained without execution. Repeat the import command with `--verify` to check preserved sources, prepared outputs and catalog registrations without writing.

## RPG source handoff libraries

The owner-supplied `RPG_Source_Asset_Handoff_Index_v1.zip` identifies the corrected Combat FX, Hearth & Harvest, Hearthwild materials, Embervale POIs and environment-detail sources. In an owned task, import the index and its Downloads archives together:

```sh
npm run assets:import-handoff
npm run assets:import-handoff -- --verify
```

The [handoff importer](../scripts/assets/generated-packs/source-handoff.mjs) verifies archive sizes and SHA-256 hashes against the index, checks supplied internal receipts, merges identical shared-volume files, rejects conflicting contents and preserves every original file. It chooses either a complete material ZIP or all its numbered volumes. `--downloads PATH` selects a different receipt directory. Missing archives fail by default; `--available` explicitly imports available collections and records the gaps, while incomplete material-volume sets still fail their map checks. Bundled source generators are retained without execution. Hearth & Hex's separately supplied refined icon ZIP is included when present; it has no independent supplied checksum and uses a retained import fingerprint.

The October 5 handoff prepares 261 scenery model variants, including four fern LOD alternatives, and 37 reference assemblies. It adds 28 material surfaces in 80 states, 46 preferred 60 Hz effect sequences with 3,029 frames across 205 pages, supporting compact/static FX and exchange meshes, 24 ground decals, and Hearth & Hex's 96 icons, 24 monochrome status symbols and ten frames.

Standalone scenery uses the existing shared catalog with IDs such as `embervale-modular-poi:model:camp-01-ridge-tent`, `embervale-rural-mill:model:mill-01-door-wall` and `woodland-understory-extension:model:w01-young-woodland-fern`. Find prepared models with `npm run levels:find -- --query embervale --limit 20` or `--query woodland-understory`. Models appear automatically as unreviewed assets in the existing Asset Review Lab. GLBs remain under ignored `public/vendor/synty/library/models/<pack>/`; the directory name is a loader convention, not Synty provenance. Reference assemblies remain outside the placeable catalog at `public/vendor/<pack>/reference-scenes/`.

Materials, FX, exchange meshes, decals and icons have a separate private URL index at `public/vendor/rpg-source-handoff/catalog.json`. Its collection entries retain source metadata and map URLs, material state/mask channels, source sampling/alpha conventions, frame rectangles, valid page counts, pivots and icon resolutions. These are prepared sources for explicit later material/effect/UI adoption; the importer adds no runtime effect system, scene placements, gameplay selections, appearance approvals or production build selections.

Preparation decodes all GLBs with pinned three.js, checks geometry and source triangle counts, validates precise Y-up bounds against supplied Blender bounds, and retains authored hierarchy and PBR factors through the shared node-material adapter. It uses precise transformed vertices for these new bounds, preserving older importers' existing bounds convention. Source Z-up placement/connectors stay labeled as source metadata; exported geometry remains metre-scale Y-up without another axis correction. Preserve radial, waterline and axle pivots when adopting modules. Authored UV overlap is intentional and does not establish baked lightmap UVs.

Image checks decode compressed PNG data without resizing or recompression. Albedo and painted RGB use sRGB; scalar masks and PBR data use linear sampling, normals use OpenGL +Y, ORM is R=AO/G=roughness/B=metallic, and material height maps retain 16-bit precision. FX metadata owns color space and straight alpha. The preferred sequences retain exactly 60 Hz source cadence, page/frame rectangles, gutters and valid-frame counts; one-shots stop at the final valid frame. Atlas mip generation remains off. Supplied compact sequences remain source alternatives. This preparation does not establish frame rate, gameplay timing or in-engine appearance.

Original ZIPs, editable Blender libraries, manifests, receipts, source textures, generators and import fingerprints stay under `.local/animation-packs/rpg-source-handoff/`. Task cleanup preserves these through the existing canonical source/unique-version retention policy. `--verify` finds retained sources on main or in completed-task archives and checks extracted originals, prepared outputs and shared model registrations without writing. Collision, navigation, wind, dynamic flames, mechanical motion and scene composition remain later adoption work.

## Gothic dungeon and environment source kits

The October 5 Downloads delivery adds **218 standalone models** and **eight reference assemblies**. In an owned task run `npm run assets:import-download-kits`; `--downloads PATH` selects another source folder. The [importer](../scripts/assets/generated-packs/download-kits.mjs) requires all numbered ZIP volumes and `Gothic_Dungeon_Props_Catalog.json`. It merges identical shared files, rejects conflicting volume contents, verifies the Gothic catalog's archive hashes/sizes and every supplied internal file receipt, and retains import fingerprints for files without supplied checksums. Bundled generators stay private and are never executed.

| Library pack | Standalone models |
| --- | --- |
| `gothic-crypt-funerary` | 16 crypt/funerary props |
| `gothic-ruined-statuary` | 16 statues/relics |
| `gothic-iron-barriers` | 16 doors/barriers |
| `gothic-chains-restraints` | 16 chains/restraints |
| `gothic-altars-ritual` | 16 altars/ritual props |
| `gothic-braziers-lighting` | 16 lighting props |
| `gothic-armory-displays` | 16 armory displays |
| `gothic-loot-debris` | 16 containers/debris props |
| `highland-pass` | 20 highland modules |
| `ashen-crossroads` | 25 ruined-settlement modules |
| `marsh-islands` | 20 wetland modules |
| `greywatch-fortress` | 25 fortress modules |

Find models with `npm run levels:find -- --query gothic-crypt-funerary --limit 20` or any pack ID above. IDs follow `<pack>:model:<lowercase-hyphenated-source-id>`, for example `gothic-crypt-funerary:model:01-sarcophagus-open`. Prepared GLBs live under ignored `public/vendor/synty/library/models/<pack>/`; this is the existing loader convention, not Synty provenance. The eight example assemblies stay outside the placeable catalog under `public/vendor/<environment-pack>/reference-scenes/`. Import retains other library entries and adds no scene placements, appearance approvals, equipment or build selections.

Preparation preserves authored binary geometry, embedded PNGs, metre-scale Y-up roots and named hierarchies. It renames descriptive `extras.pivot` strings for pinned three.js compatibility. Headless validation decodes geometry with the pinned loader, checks triangles and precise bounds against the source inventories, verifies named socket/group pivots where supplied as actual nodes, validates PNG framing/checksums/compressed scanlines, and checks node-material conversion retains PBR factors, maps and alpha settings. The CLI uses dimensions-only image objects for material-binding inspection; browser image decoding and visual appearance remain separate acceptance work.

Keep source Z-up connector/socket metadata labeled as such; exported models need no additional axis correction or recentering. Mathematical connectors do not always correspond to actual node helpers. Water, feathered mire and static flame placeholders preserve their source materials; production water/flames, collision, navigation, opening motions and gameplay behavior remain later authoring. These are library-ready visual assets, not integrated gameplay systems.

Unchanged archives, merged editable sources, textures, manifests, catalog and import receipts stay under `.local/animation-packs/download-kits/`, retained through task cleanup's canonical-source/unique-version policy. Run `npm run assets:import-download-kits -- --verify` to check preserved sources, prepared output hashes and catalog registrations without writing, including on main after cleanup. Source/import checks do not establish visual quality or runtime performance.
