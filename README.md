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
