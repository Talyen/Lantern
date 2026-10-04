# Gathering and shelter

Gathering is a brief stop during an adventure. Tools appear for the action and never occupy inventory or equipment slots. Repairing the Homestead shelter is optional; it provides storage and Rested without unlocking or gating a route.

## Contextual gathering

Left-click a standing tree or mineral outcrop to approach that specific node along a reachable path. The player closes to the working distance before swinging. Loot and world interactions take priority over the action assigned to left mouse; other clicks activate that assignment. Clicking the same gathering target continues its action, and pointer movement does not redirect it.

A living enemy within 6 m, or any pursuing enemy in the active area, prevents gathering. An approaching threat cancels it. Movement, another action, damage, menus, travel, death and lost reach cancel the sequence and restore the combat equipment. Click fires, chests, shelter or stash to approach and interact; object clicks take priority over the action-bar ability assigned to left mouse.

Three valid contacts deplete initial level-1 nodes. Each contact drops Wood, Stone or Iron through the shared [loot system](LOOT.md). Resources collect after landing; partial collection leaves the ground remainder intact. Gathering XP belongs only to successfully collected harvested quantities. Dropping or storing an already collected resource never grants XP again.

Tree collision is removed on felling; mineral outcrops retain a low depleted core. Partial harvest progress and depletion survive travel, death and restart. Each depleted resource renews after 45 minutes of active play anywhere. Renewal waits until its intact bounds and leftover source rewards are off-screen with a safety margin, at least 12 m from the player and clear of actors; unseen destination renewal also protects the arrival. Old uncollected harvest rewards disappear when their resource renews. Paused, loading, background and closed-app time do not advance the clock. Depletion and renewal do not prepare lighting.

A newly completed tree harvest starts a cosmetic fall: the stump appears and the tree becomes unavailable immediately, while its existing model topples and fades away over roughly 1.1 gameplay seconds. The existing crack/fall cues play once, with a small debris burst at visual ground contact. Motion pauses with gameplay and hit-stop; cancelling gathering after the final contact does not undo depletion or the fall. Falling trees cannot damage actors, block movement or relocate rewards.

[`TreeFelling`](../src/rendering/tree-felling.ts) owns transient motion and tree-only fade materials. `AreaInstance.fellTree(id, from)` starts a new fall; `setResourceState(id, depleted)` applies retained state without replaying it. Travel/disposal cancels pending visual effects, revisiting depleted trees shows stumps directly, and renewal restores the complete standing transform and material coverage. Missing optional models never block the harvesting or collision commit.

## Progression

[`skills.ts`](../src/gameplay/skills.ts) owns shared formulas and named tuning values. Levels derive from saved XP rather than separate saved counters.

- Total XP for level L: `xpStep × L × (L − 1) / 2`, initially `xpStep = 100`.
- Per-contact yield: `floor(baseYield × (1 + yieldGrowth × max(0, skillLevel − resourceLevel)))`, initially base yield 1 and growth 0.25.
- Gathering XP: collected quantity × resource level × base XP 10 × the active progress multiplier.

The starting recipe uses 12 Wood, 6 Stone and 3 Iron: four novice trees, two stone outcrops and one iron deposit. Recipe costs are authored data, separate from progression formulas. Inventory shows Woodcutting and Mining levels and progress; Axe Combat retains its existing XP counter.

## Shelter and stash

The damaged timber-and-canvas shelter sits beside the Homestead fire. Click the damaged shelter to approach and open its material requirements. Repair is enabled only when the entire recipe is carried in the bag. The repaired appearance and lighting prepare first; the exact recipe and permanent restoration then commit together. Failed preparation retains materials and the damaged shelter.

The repaired shelter exposes a chest and a persistent 12 × 8 stash. Click the chest to open Inventory beside Stash. Dragging, splitting, stacking and sorting use the bag's footprints and 99-unit stacks. Double-click transfers what fits; excess remains in its source. Equipped items must enter the bag before storage, and stored items must enter the bag before equipping or dropping.

Entering the repaired shelter's 3 m radius automatically refreshes Rested to 30 active-play minutes. Repair completion also grants it immediately. It adds 10% skill XP through the shared XP owner, including Axe Combat; it adds no damage or gathering yield. Refresh replaces remaining duration without stacking or waiting. Inventory displays remaining time. Paused/loading/offline time does not count; remaining time checkpoints every five active seconds and flushes on normal page exit.

## Persistence and acceptance

Character save revision 5 retains the existing key and migrates revisions 1–4, preserving item IDs, overflow recovery entries, equipment, XP, discoveries and chest claims. It adds Stone/Iron items, Mining XP, stash contents, restoration and remaining Rested time. Revision 9 also saves ground-drop XP provenance, partial harvest progress, depletion and renewal deadlines in the outing snapshot.

Use one [managed preview](DEVELOPMENT.md#working-alongside-other-agents): gather with a Bow equipped, exercise direct-click approach, cancel and encounter a threat, repair the shelter, transfer a stack and restart. Inspect the shelter silhouette and tool contacts at gameplay scale. Existing tests protect partial collection/provenance, recipe consumption, transfers, migration and Rested timing.
