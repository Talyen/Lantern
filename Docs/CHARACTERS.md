# Character preview

Open `/?lab=characters` on the local development server to browse the private roster. Search by name, filter by family, save favorites, and choose models for A or B. Both views share orbit/zoom, lighting, display height, motion and playback controls. Front, side, back and gameplay-angle presets support comparison. The gallery never changes the playable character.

## Preparation and captures

Use the project's Node version and installed npm dependencies. Conversion runs in Blender's bundled Python (`bpy`); contact sheets run separately with `python3` on PATH and require Pillow in that interpreter. Captures also require `agent-browser` on PATH with its browser installed and native WebGPU available. See [capture-tool installation](LEVEL_DESIGN.md#fast-iteration) and the [private asset workflow](ASSET_PREPARATION.md) for Blender, Synty library import and Mixamo acquisition.

Run preparation in an owned task worktree. Clone only the needed private sources with `npm run agent:sources -- --sources animation-packs,synty-library`. Prepare inputs in this order; reuse existing complete outputs when available:

1. Run `npm run assets:import-library` to prepare `public/vendor/synty/library/catalog.json` and its converted character models. Retain the licensed sources under `.local/synty-library/sources/`; Generic palette restoration reads those original textures.
2. Acquire the Mixamo characters under `.local/animation-packs/mixamo/Library/Characters/` and the animation sources through the documented Mixamo workflow. Run `npm run assets:export-character` to prepare both playable rigs and their curated motion catalogs. The full source motion index remains private at `.local/animation-packs/mixamo/converted-source-catalog.json`. The gallery baker selects **sword and shield idle**, **sword and shield run**, and **sword and shield slash** from its Mixamo pack; their original FBX sources must remain under `.local/animation-packs/` for per-character rebaking. An incomplete animation export may omit these required samples.
3. Export the gallery, then capture it using the commands below. A complete roster capture requires a complete gallery export; subset exports are for inspection.

- `npm run assets:export-characters` converts the available Synty full-body models and downloaded Mixamo characters. Blender uses the existing local installation; `--blender PATH` selects another executable. `--family NAME` and `--limit N` are inspection subsets and produce an incomplete catalog.
- `npm run assets:export-characters -- --character ID[,ID]` refreshes selected stable IDs while retaining the rest of the gallery, including local studies. Motion cache signatures include the shared baker source, so older finger mappings are not reused after baker changes.
- `npm run characters:capture -- --character ID` inspects one character, starting and closing its own loopback server and isolated headless browser. It writes private captures under `.local/character-gallery/` and a thumbnail beside the ignored vendor exports. Use `--all` explicitly for roster contact sheets; invocation without either selector is rejected.
- Add `--motions` to either capture selector for representative idle, run and attack frames. For example, `npm run characters:capture -- --all --motions --family "Synty Generic"` refreshes one family after a complete capture and retains the other families. Still frames support visual review; they do not prove the entire animation cycle is clean.

The private catalog lives at `public/vendor/character-gallery/catalog.json`. It records source identity, stable IDs, conversion failures and available per-rig sample bakes. Character models, clips and thumbnails remain under that ignored directory. No source assets, catalogs or captures are committed, and no assets are published by this workflow. The gallery is development-only and its roster, thumbnails and sample bakes are excluded from game builds. Review the build inventory and purchase terms before distribution.

## Roster and animation rules

The initial roster contains 108 downloaded Mixamo characters and 69 Synty candidates: Viking Realm (10), Goblin War Camp (15), Generic (22), Prototype (6), Shops (14), and Locomotion (2). Bundled bodies are separated by named mesh. Standalone duplicate exports, detached arms/hands, attachments and LOD duplicates are excluded. Viking previews include the existing default hair attachment. Names containing “with prop” are retained as distinct authored variants.

Generic characters restore the authored `Generic_01_A` palette referenced by the private Unity prefab renderers; the raw library model omitted that remap. Models preserve source skins, materials and UVs; embedded gallery textures are limited to 1024 pixels on the longest side. Display normalization happens in a parent group so it does not overwrite rig transforms. All preview routes require native WebGPU and use `src/rendering/webgpu-pipeline.ts` with independent temporal histories. The gallery uses the shared FSR Temporal Balanced / 0.50 defaults, Golden lighting and procedural environment reflections for metallic surfaces. It overrides AO to 0.30 and disables bloom and depth of field for clear comparisons.

The exporter reuses the canonical Mixamo world-space baker with a checked target skeleton. Numbered Mixamo namespaces normalize before mapping; missing optional finger chains stay in their rest pose. Required body bones must map. Idle, run and attack are small per-target bakes from original Mixamo sources, with horizontal travel removed and vertical hip movement retained. Runtime loading verifies animation bindings against the displayed skeleton. Missing or failed motions retain static viewing and show a concise error. Exported motion samples are automated previews: weapon placement and fine hand/foot cleanup need art review before gameplay use.

## Owners and validation

`src/labs/characters/` owns the gallery, resource disposal and development-only `window.lanternCharacters` capture bridge. `scripts/assets/characters/` owns private roster conversion and capture tooling. The existing animation exporter owns retargeting mathematics; the character gallery supplies only the mapping appropriate to each target.

After changing the workflow, inspect one affected character or gallery interaction in a real preview and run the fast `npm run check`. `characters:capture -- --character ID` targets one character; `--all` explicitly requests a roster batch. Full contact sheets and motion pages are optional catalog-audit tools. A failure on one model must leave the other comparison lane usable. Close owned GPU sessions before the final check. Gallery edits do not require gameplay smoke unless gameplay owners also change.

## Playable characters

Gameplay and the animation lab use the authored Erika Archer player, Goblin and Skeleton models. `assets/playable-characters.json` owns their model URLs, heights and per-rig motion catalogs. Gameplay selects complete equipment profiles; animation experimentation belongs in the development lab.

`npm run assets:export-character` updates the three playable entries in an existing gallery catalog, or creates a minimal playable catalog if the full gallery is absent. After a full gallery export, run that command with `--motions-only` to refresh the playable entries. `--player-only` limits preparation to Erika. Its packed defaults retain dodge.

The eight projected Paladin palettes and their original inputs/recipes are privately archived through the cleanup task, as described in [development](ASSET_PREPARATION.md#required-playable-character-and-motions). They no longer appear in the gallery or gameplay.

## Homestead merchant

`npm run assets:export-merchant` prepares only Peasant Man (`mixamo-5fb4b535-034a-4011-af3b-2880391547a5`) and neutral Mixamo Idle (`2b810890b52a`) using the existing checked world-space baker. Clone only animation sources into the owned task with `agent:sources -- --sources animation-packs`. Original color/UVs remain authored; legacy Phong reflection is corrected to diffuse clothing/skin. The packed `/vendor/characters/merchant/model.glb` contains one rig-compatible `idle`. Intermediate model, motion, catalog and provenance remain private; builds select only the packed area-referenced model and its dependencies, excluding gallery assets. Inspect the merchant's feet, idle and clothing at gameplay scale. This command never alters playable player or Goblin outputs.

## Playable skeletons

Graveyard Ruins and Graveyard Crypt use the existing Synty Generic **Skeleton 01** body at 1.8 m, while the Clearing retains its Goblin and the player uses Erika Archer. All motion providers remain Mixamo. `assets/playable-characters.json` owns the skeleton model/catalog; `assets/motion-profiles.json` owns its sword and staff profiles. The canonical exporter isolates the skeleton mesh, restores its authored Generic palette, checks canonical bones and independently bakes idle, locomotion, slash/cast, hit and death motions. Source art and prepared output remain private.

Run `npm run assets:export-character -- --skeleton-only` after cloning the animation-pack and Synty-library sources into the owned task; `--motions-only` reuses the authored body. The runtime uses `/vendor/characters/skeleton/`, never the development-gallery model path. The sword slash has a 1.05 s duration, a reviewed 0.44 s contact and a 0.16 s commitment window, independent of the player's faster slash. Check weapon sockets and motion at gameplay scale. Skeleton reactions use dry existing foley, without Goblin vocals.

The Bone Caster uses the existing enemy cast rhythm: 1.6 s duration, release at 0.8 s, and the shared additional 0.5 s cooldown. The independently baked `skeleton-cast` recipe retains those timings; do not use the faster player Staff attack for enemy casting. Skeleton health/damage use the current shared ordinary-enemy values.
