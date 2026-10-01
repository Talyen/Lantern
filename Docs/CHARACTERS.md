# Character preview

Open `/?lab=characters` on the local development server to browse the private roster. Search by name, filter by family, save favorites, and choose models for A or B. Both views share orbit/zoom, lighting, display height, motion and playback controls. Front, side, back and gameplay-angle presets support comparison. The gallery never changes the playable character.

## Preparation and captures

Use the project's Node version and installed npm dependencies. Conversion runs in Blender's bundled Python (`bpy`); contact sheets run separately with `python3` on PATH and require Pillow in that interpreter. Captures also require `agent-browser` on PATH with its browser installed and native WebGPU available. See [capture-tool installation](LEVEL_DESIGN.md#fast-iteration) and the [private asset workflow](DEVELOPMENT.md#private-asset-workflow) for Blender, Synty library import and Mixamo acquisition.

Prepare inputs in this order; reuse existing complete outputs when available:

1. Run `npm run assets:import-library` to prepare `public/vendor/synty/library/catalog.json` and its converted character models. Retain the licensed sources under `.local/synty-library/sources/`; Generic palette restoration reads those original textures.
2. Acquire the Mixamo characters under `.local/animation-packs/mixamo/Library/Characters/` and the animation sources through the documented Mixamo workflow. Run `npm run assets:export-character` to prepare both playable rigs and their curated motion catalogs. The full source motion index remains private at `.local/animation-packs/mixamo/converted-source-catalog.json`. The gallery baker selects **sword and shield idle**, **sword and shield run**, and **sword and shield slash** from its Mixamo pack; their original FBX sources must remain under `.local/animation-packs/` for per-character rebaking. An incomplete animation export may omit these required samples.
3. Export the gallery, then capture it using the commands below. A complete roster capture requires a complete gallery export; subset exports are for inspection.

- `npm run assets:export-characters` converts the available Synty full-body models and downloaded Mixamo characters. Blender uses the existing local installation; `--blender PATH` selects another executable. `--family NAME` and `--limit N` are inspection subsets and produce an incomplete catalog.
- `npm run characters:capture` starts and closes its own loopback server and isolated headless browser. It writes labeled roster contact sheets under ignored `.local/character-gallery/` and thumbnail images beside the ignored vendor exports.
- `npm run characters:capture -- --motions` also captures representative idle, run and attack frames for every candidate with those motions. Use `--family "Synty Generic"` to refresh one family after a complete capture; it retains the other families. Still frames support visual review; they do not prove the entire animation cycle is clean.

The private catalog lives at `public/vendor/character-gallery/catalog.json`. It records source identity, stable IDs, conversion failures and available per-rig sample bakes. Character models, clips and thumbnails remain under that ignored directory. No source assets, catalogs or captures are committed, and no assets are published by this workflow. Production staging currently copies non-library vendor directories wholesale: preparing this gallery increases local build size. Review the build inventory and purchase terms before distribution.

## Roster and animation rules

The initial roster contains 108 downloaded Mixamo characters and 69 Synty candidates: Viking Realm (10), Goblin War Camp (15), Generic (22), Prototype (6), Shops (14), and Locomotion (2). Bundled bodies are separated by named mesh. Standalone duplicate exports, detached arms/hands, attachments and LOD duplicates are excluded. Viking previews include the existing default hair attachment. Names containing “with prop” are retained as distinct authored variants.

Generic characters restore the authored `Generic_01_A` palette referenced by the private Unity prefab renderers; the raw library model omitted that remap. Models preserve source skins, materials and UVs; embedded gallery textures are limited to 1024 pixels on the longest side. Display normalization happens in a parent group so it does not overwrite rig transforms. All preview routes require native WebGPU and use `src/rendering/webgpu-pipeline.ts` with independent temporal histories. The gallery uses FSR Temporal / Quality / 0.2 sharpening, neutral lighting and procedural studio reflections for metallic surfaces, reduced AO and no bloom or depth-of-field blur for clear comparisons.

The exporter reuses the canonical Mixamo world-space baker with a checked target skeleton. Numbered Mixamo namespaces normalize before mapping; missing optional finger chains stay in their rest pose. Required body bones must map. Idle, run and attack are small per-target bakes from original Mixamo sources, with horizontal travel removed and vertical hip movement retained. Runtime loading verifies animation bindings against the displayed skeleton. Missing or failed motions retain static viewing and show a concise error. Exported motion samples are automated previews: weapon placement and fine hand/foot cleanup need art review before gameplay use.

## Owners and validation

`src/labs/characters/` owns the gallery, resource disposal and development-only `window.lanternCharacters` capture bridge. `scripts/assets/characters/` owns private roster conversion and capture tooling. The existing animation exporter owns retargeting mathematics; the character gallery supplies only the mapping appropriate to each target.

After changing the workflow, inspect full-roster contact sheets and motion review pages, verify search/family/favorites and linked comparison controls in a real browser, and run `npm run check`. A failure on one model must leave the other comparison lane usable. Close owned GPU sessions before the final check. Gallery edits do not require gameplay smoke unless gameplay owners also change.

## Playable Paladin variants

Gameplay and the animation lab default to the **original authored Paladin textures**. The projected palettes below remain experiments and are not selected by default.

The earlier **Charcoal iron / worn gold** variant remains available, with weathered crimson cloth and restrained decoration. **Charcoal iron / crimson** is the other grim variant; it replaces gold trim with muted crimson. These darker variants use rougher, subdued metals and reduced normal-map relief; their tabard glyphs are painted over locally. The earlier **Dark steel / brass / crimson** remains available. **Silver / gold / blue** and **Ivory / gold / teal** remain alternatives. Original ImageGen surfaces and exact text prompts live under `assets/textures/paladin/`; character inputs never leave local projection/baking. Generated detail is projected in the rest pose and baked to the existing UVs so it follows animation. All variants retain the authored normal texture and skin islands; the grim variants soften its relief and recolor the trim. These are material variants of the exact Paladin J Nordstrom model, not its W/Prop counterpart.

`npm run assets:export-character` registers the variants in an existing gallery catalog (or creates a minimal playable catalog if the full gallery is absent). If a full gallery export replaces the catalog, run that command again with `--skip-projection` to restore the variant entries. The gallery initially compares the original Paladin and Goblin. Use `?paladin=authored|iron-gold-crimson|iron-copper-teal|slate-bronze-blue|grim-gold|grim-crimson|dark-brass|silver-gold|ivory-gold` on gameplay routes for identical-camera comparisons. The animation lab defaults to this Paladin rig; Goblin D Shareyko has a separate gameplay catalog and no shared-rig assumptions.

The Paladin additionally retains a player-only embedded dodge action. `npm run assets:export-character -- --player-only --motions-only` updates compatible Paladin motions and repacks existing surfaces without re-projecting textures or modifying Goblin outputs. New Paladin variants must pack all catalog defaults, including dodge.

The balanced palettes use **mid-tone iron / gold / crimson**, **iron / copper / teal**, and **slate / bronze / blue**. Large shoulder/forearm armor parts and the helmet carry the secondary metal; cloth panels carry the strong tertiary color. Local bone-weight and authored-UV face masks preserve skin and replace cloth glyphs, avoiding new filigree. Those masks are baked into the existing UVs and removed before GLB export, retaining all animation bindings including dodge.

For surface-only iteration, project selected palettes with Blender's `scripts/assets/characters/project-paladin.py --variant NAME` (arguments follow Blender's `--` separator; `--output PATH` supports isolated staging). After copying completed raw models to their configured private paths, `npm run assets:export-character -- --player-only --surfaces-only --skip-projection` repacks the current motion defaults and registers comparisons without rebaking source motions or touching Goblin outputs.
