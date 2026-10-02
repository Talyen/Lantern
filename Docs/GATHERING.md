# Gathering and shelter

Gathering is a brief stop during an adventure. Tools appear for the action and never occupy inventory or equipment slots. Repairing the Homestead shelter is optional; it provides storage and Rested without unlocking or gating a route.

## Contextual gathering

Left-click a standing tree or mineral outcrop to approach that specific node along a reachable path. Otherwise, aiming within a 30-degree half-cone toward a resource within 1.8 m of its surface selects it. The player closes to the working distance before swinging. Loot retains click priority; other clicks perform the normal Basic attack. Clicking the same gathering target continues its action, and pointer movement does not redirect it.

A living enemy within 6 m, or any pursuing enemy in the active area, prevents gathering. An approaching threat cancels it. Movement, another action, damage, menus, travel, death and lost reach cancel the sequence and restore the combat equipment. E remains the interaction key for travel, chests, shelter repair and storage.

Three valid contacts deplete initial level-1 nodes. Each contact drops Wood, Stone or Iron through the shared [loot system](LOOT.md). Resources collect after landing; partial collection leaves the ground remainder intact. Gathering XP belongs only to successfully collected harvested quantities. Dropping or storing an already collected resource never grants XP again.

Tree collision is removed on felling; mineral outcrops retain a low depleted core. Session depletion survives travel and death. Both renew after 120 active gameplay seconds, deferring occupied locations. Restart refreshes resources; time-away renewal remains future work. Depletion and renewal do not prepare lighting.

## Progression

[`skills.ts`](../src/gameplay/skills.ts) owns shared formulas and named tuning values. Levels derive from saved XP rather than separate saved counters.

- Total XP for level L: `xpStep × L × (L − 1) / 2`, initially `xpStep = 100`.
- Per-contact yield: `floor(baseYield × (1 + yieldGrowth × max(0, skillLevel − resourceLevel)))`, initially base yield 1 and growth 0.25.
- Gathering XP: collected quantity × resource level × base XP 10 × the active progress multiplier.

The starting recipe uses 12 Wood, 6 Stone and 3 Iron: four novice trees, two stone outcrops and one iron deposit. Recipe costs are authored data, separate from progression formulas. Inventory shows Woodcutting and Mining levels and progress; Axe Combat retains its existing XP counter.

## Shelter and stash

The damaged timber-and-canvas shelter sits beside the Homestead fire. E opens its material requirements. Repair is enabled only when the entire recipe is carried in the bag. The repaired appearance and lighting prepare first; the exact recipe and permanent restoration then commit together. Failed preparation retains materials and the damaged shelter.

The repaired shelter exposes a chest and a persistent 12 × 8 stash. E opens Inventory beside Stash. Dragging, splitting, stacking and sorting use the bag's footprints and 99-unit stacks. Double-click transfers what fits; excess remains in its source. Equipped items must enter the bag before storage, and stored items must enter the bag before equipping or dropping.

Entering the repaired shelter's 3 m radius automatically refreshes Rested to 30 active-play minutes. Repair completion also grants it immediately. It adds 10% skill XP through the shared XP owner, including Axe Combat; it adds no damage or gathering yield. Refresh replaces remaining duration without stacking or waiting. Inventory displays remaining time. Paused/loading/offline time does not count; remaining time checkpoints every five active seconds and flushes on normal page exit.

## Persistence and acceptance

Character save revision 4 retains the existing key and migrates revisions 1–3, preserving item IDs, overflow recovery entries, equipment, XP, discoveries and chest claims. It adds Stone/Iron items, Mining XP, stash contents, restoration and remaining Rested time. Ground-drop XP provenance and resource depletion remain session state.

Use one [managed preview](DEVELOPMENT.md#working-alongside-other-agents): gather with a Bow equipped, exercise direct-click approach and facing selection, cancel and encounter a threat, repair the shelter, transfer a stack and restart. Inspect the shelter silhouette and tool contacts at gameplay scale. Existing tests protect partial collection/provenance, recipe consumption, transfers, migration and Rested timing.
