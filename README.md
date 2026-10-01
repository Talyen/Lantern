# Lantern

A desktop-browser fantasy action RPG prototype using TypeScript, three.js, Vite, and a local Electron shell. Play begins on a woodland path between Homestead and a guarded goblin camp.

## Run

Use Node 24 (the version in `.node-version`) and npm 11+:

```sh
npm ci
npm run dev
```

Lantern requires native WebGPU with hardware acceleration on a supported browser/OS/GPU. Unsupported systems receive a startup error. Gameplay, authoring and animation comparison share one visual pipeline; FSR Temporal is the sole reconstruction method, with fixed 1× output density and independent resolution, shadow and particle quality controls.

Open Vite's printed local URL to begin halfway along Forest Clearing’s approach. WASD or arrows move, left click attacks toward the pointer, Shift dodges, E interacts, B toggles Inventory, Esc opens Options or closes a menu, and the mouse wheel zooms. Walk home or approach the goblin camp, defeat its guard and open the chest for two return scrolls. Discover campfires on foot, then travel between safe fires; use Scrolls of Return to open a round-trip portal home. Safe campfires heal 3% maximum health per second nearby; enemies within 10 m or pursuing/returning in the area block healing and travel. Both actors have 100 health; player hits deal 50 and goblin hits deal 20. Defeat offers Return Home without losing collected scrolls. Scroll inventory and discovered campfires save locally; encounters and chest rewards refresh after restarting at the clearing midpoint. Options pauses play and contains graphics controls and rock inspection where available. Use `/?area=clearing` for direct encounter testing.

The public repository contains source and original generated surface studies. Playable Mixamo Paladin/Goblin character art and compatible animations must be prepared privately; missing character art produces an actionable import message. Optional scenery can be absent. See the [asset workflow](Docs/DEVELOPMENT.md#private-asset-workflow).

```sh
npm run check       # local handoff and asset-free CI checks
npm run desktop     # build and open Electron for manual play
npm run desktop:check -- --debug-port=9231  # hidden Electron; attach CDP
```

## Documentation

- [Architecture](Docs/ARCHITECTURE.md): runtime owners and simulation boundaries.
- [Development](Docs/DEVELOPMENT.md): commands, private assets, validation, and smoke flows.
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
