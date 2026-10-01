# Item drops and pickups

This is the agreed design for [Milestone 3](../ROADMAP.md#milestone-3--loot-recovery-and-homestead), with gathering consumers in milestone 4. Gameplay implementation remains outstanding. The current subset has small 3D raider scroll drops with nearby auto-pickup and one stack capped at 99; the clearing chest transfers scrolls directly into inventory. This document does not change runtime APIs or save formats.

## Drops and collection

Enemies, chests, world supplies, Woodcutting, and Mining use one shared ground-drop system. Chests scatter their rewards onto the ground rather than depositing them directly into inventory. Woodcutting yields Wood; Mining yields Stone and Iron; Hide can come from enemies, chests, and supplies. Keep the first equipment rewards authored with useful tradeoffs; random affixes and rarity systems remain deferred.

Each drop has a small recognizable 3D object. Start with representative category models: equipment silhouettes, coins, material bundles, potions, and scrolls. A brief toss and slight tumble end in a settled resting pose, with restrained landing and collection sounds. Avoid persistent beams, glow, or constant idle animation. Resolve placement on reachable ground using the existing navigation and collision boundaries.

| Loot | Collection | Destination |
| --- | --- | --- |
| Weapons, armor, and other equipment | Click the label or ground object | Inventory; never automatically equipped |
| Gold | Automatic within 1.5 m after landing; clicking can request an approach | Separate character wallet; no inventory slots or 99-stack rule |
| Materials, consumables, scrolls, and other currencies | Automatic within 1.5 m after landing; clicking can request an approach | Inventory stacks of up to 99 |

Automatic collection operates during combat and requires no pickup action. Landing must finish before collection becomes eligible. Fill existing stacks first, then create additional stacks if inventory space permits. Transfer only the quantity that fits and leave the remainder on the ground. A full inventory never destroys or silently discards loot.

Clicking either an item's label or its object selects the same drop. Within 1.5 m, collect eligible loot immediately; farther away, walk along a reachable route and collect on arrival. Movement input, an attack, dodge, opening a menu, death, and area travel cancel the approach. Selecting another drop replaces the target. Loot clicks take priority over attacks, so selecting an item does not also swing a weapon.

An unreachable route or a full-inventory attempt leaves the drop intact and gives brief feedback such as "Can't reach item" or "Inventory full". Do not turn blocked automatic collection into repeated messages or sounds. Labels continue to show only the item name.

Uncollected loot remains through death and area travel without a despawn timer. Application restart refreshes the world and removes uncollected drops; collected character progress survives under the planned broader persistence system. Keep ground loot separate from permanent character progress and the future time-away renewal system.

## Labels and visual treatment

The player sees Gothic names on compact smoky backplates above small physical objects. Warm ivory lettering, muted gold currency, and a restrained brass hover edge make loot readable against the autumn woodland without competing with combat.

Every nearby on-screen drop has a persistent item-name-only label. Do not add quantity, type, stats, comparisons, or hover tooltips. Keep each drop individually labeled; do not merge identical supplies or collapse piles into a group label.

| Element | Starting treatment |
| --- | --- |
| Font | Locally bundled [Pirata One](https://github.com/google/fonts/blob/main/ofl/pirataone/DESCRIPTION.en_us.html), mixed case, 20 CSS pixels |
| Item names | Warm ivory `#E9E5DC` |
| Gold name | Muted gold `#D8B46A` |
| Backplate | Smoky charcoal `#171411` at 90% opacity |
| Hover border | Restrained brass `#B58B55` |
| Nearby distance | 12 m from the player, limited to on-screen drop anchors |

Separate crowded labels into compact non-overlapping rows near their objects. Hovering a label subtly highlights its matching ground object; hovering the object highlights its label. Keep the association clear as the camera moves and items are collected.

Labels remain readable over scenery, including props hiding the object. Visibility does not grant remote collection: a reachable route and physical proximity remain required. Keep text at a stable screen size across zoom, with no off-screen indicators. Distance, font size, and spacing are initial visual tuning values; validate them at gameplay scale. Bundle the font locally with its license when implementing this presentation.

See [Art Direction](ART_DIRECTION.md#loot-presentation-planned) for its place in Lantern's visual hierarchy.

## Ownership and integration

Follow the existing [architecture](ARCHITECTURE.md#owners-and-data-flow): simulation owns rewards, drop identities and quantities, pickup eligibility, inventory transfers, approach targets, and lifetime. Rendering owns the objects and their animation; UI owns labels, hover, and selection requests. Presentation never awards an item or removes it independently of a successful simulation transfer.

Extend the continuing Adventure state and its area snapshots, using the existing navigation/collision adapter for pickup approaches. Keep input priority explicit in the clearing coordinator. Render loot through the shared native WebGPU pipeline with TSL/node materials, and project labels using the displayed unjittered camera. Do not introduce a separate render graph or backend. Drop animation follows the gameplay pause gates; landing eligibility remains simulation-owned rather than decided by a render callback.

Broader inventory capacity, authored reward quantities, and economy balance belong to their milestone implementations. The rules established here are a separate gold wallet, multiple 99-item stacks for other supplies, partial transfers, and session ground loot. Preserve the current scroll/save behavior until the inventory and persistence work replaces it deliberately; this documentation task performs no migration or font/asset installation.

## Implementation acceptance

Use a few representative player flows when implementing, following [Development](DEVELOPMENT.md#commands-and-handoff). These are future acceptance scenarios, not checks already passed by this design.

1. **Fight and collect:** defeat an enemy, watch its rewards toss and settle, and collect nearby supplies while combat remains active. Click equipment by label and by object; each request collects once, never attacks or auto-equips it.
2. **Chest and crowded loot:** open a chest, select individual rewards from separated name-only labels, and approach distant gear. Confirm hover identifies the matching object, including when scenery obscures it.
3. **Gather and overflow:** harvest Wood, Stone, and Iron through the same drop presentation. Fill a stack to 99, start another stack, then partially collect with limited space and retain the remainder. Gold increases the wallet without consuming slots.
4. **Cancel and fail an approach:** cancel with movement, attack, dodge, menus, death, or travel; replace the target with another drop. An unreachable item or full inventory gives brief feedback and preserves the loot without repeated automatic notifications.
5. **Travel, death, and restart:** leave drops behind, travel away, die and return, and find the same remaining loot. Restart refreshes ground loot while saved collected progress survives under the completed persistence system.

Review golden and silver lighting at minimum and maximum gameplay zoom, including crowded rewards, bright ground, dark scenery, and camera movement. Inspect Gothic readability, stable label placement, small-object recognition, and combat visibility; revise the weakest visible part before acceptance. Retain only a few high-value automated outcomes by extending existing tests where useful. Finish implementation with the normal handoff gate and report unverified gameplay or visual behavior.
