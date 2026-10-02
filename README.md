# Lantern

A desktop-browser fantasy action RPG prototype using TypeScript, three.js, Vite, and a local Electron shell. Play begins on a woodland path between Homestead and a guarded goblin camp.

## Run

Use Node 24 (the version in `.node-version`) and npm 11+:

```sh
npm ci
npm run dev
```

Lantern requires native WebGPU with hardware acceleration on a supported browser/OS/GPU. Unsupported systems receive a startup error. Gameplay, authoring and animation comparison share one visual pipeline; FSR Temporal is the sole reconstruction method, with fixed 1× output density and independent resolution, shadow and particle quality controls.

Open Vite's printed local URL to begin halfway along Forest Clearing’s approach.

| Control | Action |
| --- | --- |
| WASD / arrows | Move |
| Left click | Attack toward the pointer, gather a selected resource, or select ground loot |
| Right mouse, held | Block with an equipped Shield |
| Shift | Dodge |
| E | Interact with fires, chests, shelter and stash |
| B | Toggle Inventory |
| Escape | Close a menu or open Options |
| Mouse wheel | Zoom |

Walk home or approach the goblin camp, defeat its guard and open the chest for two return scrolls and unclaimed Sword, Shield, Bow and Staff rewards. A separate staff-wielding caster waits off the left side of the woodland approach. Pick up equipment by clicking its object or name label, then equip it in Inventory; Wood, Stone, Iron and scrolls collect automatically nearby after landing.

Discover campfires on foot, then travel between safe fires, or cast a Scroll of Return to open a round-trip portal home. Safe campfires heal 3% maximum health per second within 3 m; enemies within 10 m of the fire or pursuing/returning anywhere in the area block healing and travel. Player and enemies have 100 health; current basic player hits deal 50 and enemy hits deal 20 before shield blocking. Defeat offers Return Home with collected items retained.

Inventory, equipment, materials, Woodcutting/Mining/Axe Combat XP, collected chest weapon claims, discovered fires, shelter restoration, stash contents and remaining Rested time save locally. Ground drops, enemies and open chests retain session state through travel/death; restarting refreshes the world at the clearing midpoint with full health. Options pauses play and contains Graphics and Sound controls. Rock inspection and Restart belong to development level authoring. See [level design](Docs/LEVEL_DESIGN.md#fast-iteration) for that workflow.

Gather Wood, Stone and Iron to repair the Homestead shelter, unlock its stash and refresh Rested. See [gathering and shelter](Docs/GATHERING.md).

The public repository contains source and original generated surface studies. Playable Mixamo Paladin/Goblin character art and compatible animations must be prepared privately; missing character art produces an actionable import message. Optional scenery can be absent. See the [asset workflow](Docs/DEVELOPMENT.md#private-asset-workflow).

```sh
npm run check       # change-aware local sanity gate
npm run check:full  # full production/build gate used by CI
npm run desktop     # build and open Electron for manual play
npm run desktop:check -- --debug-port=9231  # hidden Electron; attach CDP
```

## Documentation

- [Architecture](Docs/ARCHITECTURE.md): runtime owners and simulation boundaries.
- [Development](Docs/DEVELOPMENT.md): commands, private assets, validation, and smoke flows.
- [Art direction](Docs/ART_DIRECTION.md): visual identity and review criteria.
- [Graphics settings](Docs/GRAPHICS.md): current controls, defaults and comparison URLs.
- [Lighting](Docs/LIGHTING.md): shared Golden preset, local lights and explicit bake preparation.
- [Gameplay sound](Docs/AUDIO.md): event timing, sound controls and private preparation.
- [Loot](Docs/LOOT.md): inventory, physical drops, labels and pickup rules.
- [Animations](Docs/ANIMATIONS.md): compatible profiles, action clocks and review evidence.
- [Level design](Docs/LEVEL_DESIGN.md): area definitions, travel, and rapid visual authoring.
- [Character preview](Docs/CHARACTERS.md): private roster preparation and model/motion comparison.
- [Library trials](Docs/LIBRARY_TRIALS.md): retained gameplay integrations and deferred alternatives.
- [Performance](Docs/PERFORMANCE.md): matched measurements and historical art/renderer evidence.
- [Roadmap](ROADMAP.md): milestone direction.
- [Agent guide](AGENTS.md): working and testing rules.
- [Third-party notices](THIRD_PARTY_NOTICES.md): source and asset provenance.

## License

Original Lantern code and content are source-available for noncommercial use under [CC BY-NC 4.0](LICENSE.md), following Alchemy's policy. Commercial use requires separate permission from the copyright owner. Third-party material retains its own terms, including the MIT-licensed three.js adaptation. Public source availability does not grant rights to privately supplied Synty or Mixamo assets.

## Source layout

`src/clearing/` coordinates the playable encounter, actors, input and camera. `src/levels/` owns area definitions, scenery construction and authoring; `src/gameplay/` contains the browser-independent simulation; `src/rendering/` owns graphics; `src/ui/` owns menus and HUD. Shared asset loading and combat motions live in `src/assets/` and `src/animation/`. Animation and character comparison live in `src/labs/animations/` and `src/labs/characters/`. Asset preparation tools are grouped under `scripts/assets/`, and level-authoring tools under `scripts/levels/`; build and verification entry points remain in `scripts/`. See [architecture](Docs/ARCHITECTURE.md) for ownership and dependency boundaries.

Character and animation comparison labs are development-only. Game builds stage referenced gameplay art and exclude the private gallery roster and retired surface experiments.
