# Lantern

A desktop-browser fantasy action RPG prototype using TypeScript, three.js, Vite, and a local Electron shell. Explore Homestead, Forest Clearing, Graveyard Ruins and the optional Graveyard Crypt.

## Run

Use Node 24 (the version in `.node-version`) and npm 11+:

```sh
npm ci
npm run dev
```

Lantern requires native WebGPU with hardware acceleration on a supported browser/OS/GPU. Unsupported systems receive a startup error. Gameplay, authoring and animation comparison share one visual pipeline; FSR Temporal is the sole reconstruction method, with output matching the drawable viewport in physical pixels and independent resolution, shadow and particle quality controls.

Open Vite's printed local URL. New characters begin at Homestead; returning characters resume at their last safe campfire with full health and their saved outing intact. For a disposable development fixture, `/?author=levels&area=clearing` starts at the clearing's authored midpoint; use Play in the authoring controls to enable movement.

| Control | Action |
| --- | --- |
| WASD / arrows | Move |
| Q / E / R / G / LMB / RMB | Activate an assigned action-bar ability; left-click objects to approach and interact |
| Shift | Dodge |
| F / T / Tab / K | Health Potion / Scroll of Return / weapon swap / Skills |
| B | Toggle Inventory |
| Escape | Close a menu or open Options |

Options → Camera Distance selects Default or Far; gameplay wheel zoom is disabled.

Assign abilities in Skills. Hold the input assigned to Shield Basic to block with an equipped Shield; right mouse is an assignable action slot. Action-bar assignments and both weapon sets save with character progress. Options → Keybindings remaps keyboard/mouse inputs with primary and secondary bindings.

Follow the woodland path to Forest Clearing's goblin camp and its separate staff-wielding caster. Chests open independently of nearby enemies; the camp chest scatters two return scrolls, two Health Potions and unclaimed equipment. Pick up equipment by clicking its object or name label, then equip it in Inventory; gold, Wood, Stone, Iron, Health Potions and scrolls collect automatically nearby after landing. The [equipment guide](Docs/EQUIPMENT.md#guaranteed-discoveries-and-persistence) lists guaranteed discoveries.

Discover campfires on foot, then travel from a safe fire to any discovered destination, or cast a Scroll of Return to open a round-trip portal home. Safe campfires heal 3% maximum health per second within 3 m; enemies within 10 m of the fire or pursuing/returning anywhere in the area block healing and interaction at that fire. Destination enemies do not block travel. Base player health is 100; ordinary enemies have 200 health and deal 20 direct damage before armor/blocking. Weapon and proficiency bonuses follow the [combat values](Docs/EQUIPMENT.md#combat-values). Defeat offers Return Home with collected items retained.

Inventory, equipment, wallet/buyback, all skill XP, collected equipment claims, discovered fires, shelter restoration, stash and remaining Rested time save locally. Relaunching also preserves enemy health/defeat, chests, ground drops, resource progress, renewal deadlines, portal pairs and committed cooldowns. Individual sources renew after 45 active-play minutes when safely out of view; closed-app time does not advance renewal or Rested. Options pauses play and contains Graphics, Sound, Combat Text and access to Keybindings. Rock inspection and the world-resetting Restart command belong to development level authoring. See [save recovery](Docs/RUNTIME.md#save-recovery) and [level design](Docs/LEVEL_DESIGN.md#fast-iteration).

Gather Wood, Stone and Iron to repair the Homestead shelter, unlock its stash and refresh Rested. See [gathering and shelter](Docs/GATHERING.md).

The public repository contains source and original generated surface/UI art. Playable B1 Adventurer, Goblin and Skeleton art and their compatible Mixamo animations must be prepared privately; missing required character art produces an actionable import message. Optional scenery can be absent. See the [asset workflow](Docs/ASSET_PREPARATION.md).

```sh
npm run check       # change-aware local sanity gate
npm run check:full  # CI gate; requested local use adds -- --allow-local
npm run desktop     # build and open Electron for manual play
npm run desktop:check -- --debug-port=9231  # hidden Electron; attach CDP
```

Agents use the [private task workflow](Docs/DEVELOPMENT.md#working-alongside-other-agents) before editing. Routine handoff uses the light gate; a specifically requested local full gate is `npm run check:full -- --allow-local`. Managed GPU reviews allow one owned session, and measurements borrow that preview's lease.

## Documentation

- [Architecture](Docs/ARCHITECTURE.md): task routing and simulation boundaries.
- [Development](Docs/DEVELOPMENT.md): daily workflow and read-only agent tools.
- [Runtime reference](Docs/RUNTIME.md): detailed owner contracts.
- [Development reference](Docs/DEVELOPMENT_REFERENCE.md): resource rules, commands and acceptance policy.
- [Asset preparation](Docs/ASSET_PREPARATION.md): explicit private imports and surface recipes.
- [Interaction references](Docs/SMOKE_REFERENCES.md): optional targeted gameplay flows.
- [Art direction](Docs/ART_DIRECTION.md): visual identity and review criteria.
- [UI design system](Docs/UI_DESIGN.md): shared direction, foundation specifications, interaction rules and staged adoption.
- [UI design workflow](Docs/ui/WORKFLOW.md): briefs, original ImageGen concepts, functional prototypes and screen coverage.
- [Active UI exploration](Docs/ui/DESIGN_EXPLORATION.md): first-principles design and remaining questions; Inventory/stash, Skills, HUD and loading have integrated implementations.
- [Graphics settings](Docs/GRAPHICS.md): current controls, defaults and comparison URLs.
- [Lighting](Docs/LIGHTING.md): shared Golden preset, local lights and explicit bake preparation.
- [Gameplay sound](Docs/AUDIO.md): event timing, sound controls and private preparation.
- [Loot](Docs/LOOT.md): inventory, physical drops, labels and pickup rules.
- [Gathering and shelter](Docs/GATHERING.md): Woodcutting, Mining, restoration, stash and Rested.
- [Combat and equipment](Docs/EQUIPMENT.md): authored gear, combat values, Sword/Bow mastery and the Axe kit.
- [Protagonist appearance](Docs/PROTAGONISTS.md): selected B1 art, rig and private preparation.
- [Animations](Docs/ANIMATIONS.md): compatible profiles, action clocks and review evidence.
- [Level design](Docs/LEVEL_DESIGN.md): area definitions, travel, and rapid visual authoring.
- [Character preview](Docs/CHARACTERS.md): private roster preparation and model/motion comparison.
- [Asset Review Lab](Docs/ASSET_REVIEW.md): appearance approval, changed-art eligibility and separate cleanup.
- [Desktop candidates](Docs/DESKTOP.md): packaging, diagnostic export and Windows acceptance.
- [Library trials](Docs/LIBRARY_TRIALS.md): retained gameplay integrations and deferred alternatives.
- [Performance](Docs/PERFORMANCE.md): matched measurements and historical art/renderer evidence.
- [Roadmap](ROADMAP.md): current milestones and acceptance targets.
- [Implementation history](Docs/archive/IMPLEMENTATION_HISTORY.md): dated implementation reports.
- [Agent guide](AGENTS.md): working and testing rules.
- [Third-party notices](THIRD_PARTY_NOTICES.md): source and asset provenance.

## License

Original Lantern code and content are source-available for noncommercial use under [CC BY-NC 4.0](LICENSE.md), following Alchemy's policy. Commercial use requires separate permission from the copyright owner. Third-party material retains its own terms, including the MIT-licensed three.js adaptation. Public source availability does not grant rights to privately supplied Synty or Mixamo assets.

## Source layout

`src/session/` coordinates each selected adventure across areas, including actors, input and camera. `src/levels/` owns area definitions, scenery construction and authoring; `src/gameplay/` contains the browser-independent simulation; `src/rendering/` owns graphics; `src/ui/` owns menus and HUD. Shared asset loading and combat motions live in `src/assets/` and `src/animation/`. Animation and character comparison live in `src/labs/animations/` and `src/labs/characters/`. Asset preparation tools are grouped under `scripts/assets/`, and level-authoring tools under `scripts/levels/`; build and verification entry points remain in `scripts/`. See [architecture](Docs/ARCHITECTURE.md) for ownership and dependency boundaries.

Character and animation comparison labs are development-only. Game builds stage referenced gameplay art and exclude the private gallery roster and retired surface experiments.
