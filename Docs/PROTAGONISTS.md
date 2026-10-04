# Protagonist appearance

## Selected character

Lantern uses the finished Mixamo **Erika Archer** model as its single player appearance. A male/female choice and character creation are not required. Keep her authored face, hair, outfit, geometry, UVs and textures; future color or surface studies can follow actual gameplay inspection. Equipped weapons and shields remain visible, while armor items do not replace the permanent outfit.

[The playable manifest](../assets/playable-characters.json) owns source identity, model URL, display height and compatible motion catalog. The player remains the same gameplay/save identity, so existing equipment, skills and adventure progress are retained.

The earlier generated pair concepts and procedural male studies are retired experiments, not appearance requirements. Original concept files and private source archives remain preserved. Do not continue constructing replacement human meshes from those studies.

## Quiver and preparation

Use Erika without the separate held Bow/Arrow props. Her authored quiver bag and five arrows are disconnected islands within the clothing mesh. [Erika preparation](../scripts/assets/characters/erika.py) separates those islands into the skinned `character-quiver` node without welding, reshaping or reauthoring the source geometry. The cross-body harness remains part of the outfit.

[Equipment presentation](../src/rendering/equipment.ts) shows the quiver only for a committed Bow-family loadout, including Yew Longbow. Failed or superseded preparation does not change the active appearance. Gathering temporarily hides held combat weapons without changing the equipped set, so a bow user's quiver remains attached. Default unarmed attachment and equipment disposal hide it.

In an owned task, clone animation sources and run `npm run assets:export-character -- --player-only`. Full roster preparation also needs the Synty source library. The canonical exporter derives the selected source and destination from the playable manifest. Editable separated art is saved privately under `.local/animation-packs/Protagonists/erika/`; prepared output stays under `public/vendor/characters/erika/`.

Playable preparation retains source texture resolution; the optional gallery still bounds textures to 1024 pixels. The existing legacy Phong conversion clears untextured metalness for Erika, as it does for Paladin/Goblin. ReflectionFactor is not physical metalness for skin, hair and clothing; original color, normal and specular inputs remain authored.

The exporter also adds a non-rendered `lantern-socket` at an authored belt vertex, parented to that vertex's dominant skin bone. The cage handle hangs at this socket with a small connector hook. The shared gameplay/viewer lantern retains its amber recipe and initial chest emitter/bounce positions rather than moving the lighting to belt height.

Curated and historical player clips are independently baked to Erika with the source selections, trims and contact/release markers in [the motion manifest](../assets/motion-profiles.json). Later Sword/Bow and Axe ability additions extend the initial 43-clip preparation; use the manifest and compatible catalog for the current selection. Ring and little finger chains use the current checked baker. Never borrow the old Paladin-baked tracks simply because bone names match. [Animation ownership](ANIMATIONS.md) governs motion preparation and review.

## Acceptance

The source/prepared position and UV multisets match exactly: 11,971 vertices before and after quiver separation. Prepared clips bind to the new skeleton. Native WebGPU review exercises Bow, Sword/Shield, Staff, Axe/gathering and roll poses, including bow-only quiver visibility and the normal game route. The animation viewer uses shared Golden lighting and optional gameplay personal lantern lighting; its lens blur/glare is disabled for inspection.

Sanity and affected-art checks establish source/reference validity, not cross-platform visual or performance acceptance. Follow the daily workflow for one owned gameplay interaction, task review and local integration; do not run benchmarks or full local suites by default. Retain actual captures privately with the task evidence.
