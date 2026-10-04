# Item drops and pickups

Implementation acceptance follows the [lean task workflow](DEVELOPMENT.md#working-alongside-other-agents): inspect one representative loot interaction at normal gameplay scale. Alternate lighting/zoom and broader comparison scenarios below are optional targeted references.


The physical-drop system is implemented for enemy scrolls, the clearing chest's equipment/scroll/potion rewards, harvested Wood/Stone/Iron, and player-dropped inventory items. The full shared equipment layout and authored stat tradeoffs are implemented; gold and the Homestead shop are implemented; broader reward pacing remains planned. See [combat and equipment](EQUIPMENT.md).

The bag is a 12 × 8 grid. Sword uses 1 × 3 cells; Axe and Shield use 2 × 3; Bow and Staff use 2 × 4. Wood, Stone, Iron, Health Potion and Scroll of Return stacks each use 1 × 1, stack to 99, and can occupy multiple cells. Each equipment copy has its own identity; equipped hand and shared armor/accessory items occupy equipment slots instead of bag space. Item dimensions belong to `src/gameplay/inventory.ts`, alongside placement, transfers and packing.

Pickups auto-place without shuffling the bag. Drag to move, merge, equip or drop outside the panel; invalid moves and Escape cancel. Shift-click chooses an amount to split, then click its destination or the world outside the panel. Sort consolidates supplies and packs larger objects first, committing only when everything fits. Equipped-item displacement and asset/motion preparation must succeed before any equipment change commits. Player-dropped supplies wait until the player leaves their pickup radius and returns, or explicitly selects them.

Character save revision 9 retains the existing key, migrates previous equipment/resources/progress, and saves item copies, stacks, positions, equipment slots and individual chest claims. Legacy quantities beyond capacity remain in saved **Unpacked items**; right-click to recover what fits or drag/split them into the bag or world. Chest weapons are claimed on collection, so renewal can reoffer unclaimed rewards while preserving already collected claims. Dropping collected equipment does not reset its claim.

## Drops and collection

Enemies, chests, Woodcutting and inventory dropping use one shared ground-drop system. Mining uses this same owner; future world supplies must as well. Chests scatter their rewards onto the ground rather than depositing them directly into inventory. Woodcutting yields Wood; Mining yields Stone and Iron; Hide remains planned for enemies, chests, and supplies. Keep the first equipment rewards authored with useful tradeoffs; random affixes and rarity systems remain deferred.

Each drop has a small recognizable 3D object. Start with representative category models: equipment silhouettes, coins, material bundles, potions, and scrolls. A brief toss and slight tumble end in a settled resting pose, with restrained landing and collection sounds. Avoid persistent beams, glow, or constant idle animation. Resolve placement on reachable ground using the existing navigation and collision boundaries.

The table defines the shared collection contract. Equipment, Gold, Wood, Stone, Iron, Health Potions and scrolls are implemented; other supply categories remain planned.

| Loot | Collection | Destination |
| --- | --- | --- |
| Weapons, armor, and other equipment | Click the label or ground object | Inventory; never automatically equipped |
| Gold | Automatic within 1.5 m after landing; clicking can request an approach | Separate character wallet; no inventory slots or 99-stack rule |
| Materials, consumables, scrolls, and other currencies | Automatic within 1.5 m after landing; clicking can request an approach | Inventory stacks of up to 99 |

Automatic collection operates during combat and requires no pickup action. Landing must finish before collection becomes eligible. Fill existing stacks first, then create additional stacks if inventory space permits. Transfer only the quantity that fits and leave the remainder on the ground. A full inventory never destroys or silently discards loot.

Clicking either an item's label or its object selects the same drop. Within 1.5 m, collect eligible loot immediately; farther away, walk along a reachable route and collect on arrival. Movement input, an attack, dodge, opening a menu, death, and area travel cancel the approach. Selecting another drop replaces the target. Loot clicks take priority over attacks, so selecting an item does not also swing a weapon.

An unreachable route or a full-inventory attempt leaves the drop intact and gives brief feedback such as "Can't reach item" or "Inventory full". Do not turn blocked automatic collection into repeated messages or sounds. Labels continue to show only the item name.

Uncollected loot survives death, travel and restart. Enemy, chest and harvest rewards retain their source identity and expire only when that source renews after 45 active-play minutes. Renewal waits while the source or any of its rewards is visible or within 12 m of the player. Player-dropped items have no source and remain until collected. Partial pickups keep the remainder and provenance; collecting and re-dropping an item removes its original source association. Collected one-time equipment claims remain permanent across renewal. Chests open independently of nearby enemies and renew on their own timer.

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

Labels remain readable over scenery, including props hiding the object. Visibility does not grant remote collection: a reachable route and physical proximity remain required. Keep text at a stable screen size across zoom, with no off-screen indicators. Distance, font size, and spacing are initial visual tuning values; validate them at gameplay scale. The font and its license are bundled locally under `public/fonts/`.

See [Art Direction](ART_DIRECTION.md#loot-presentation) for its place in Lantern's visual hierarchy.

## Ownership and integration

Follow the existing [architecture](ARCHITECTURE.md#owners-and-data-flow): simulation owns rewards, drop identities and quantities, pickup eligibility, inventory transfers, approach targets, and lifetime. Rendering owns the objects and their animation; UI owns labels, hover, and selection requests. Presentation never awards an item or removes it independently of a successful simulation transfer.

[Ground loot](../src/gameplay/ground-loot.ts) owns drop data, landing, collection and partial transfers. [Adventure rewards](../src/gameplay/adventure-rewards.ts) builds ordered chest/enemy rewards with the shared gold formula. [Adventure](../src/gameplay/adventure.ts) owns session eligibility, XP, events and persistence; presentation imports loot types and timing from the ground-loot owner.

Extend the continuing Adventure state and its area snapshots, using the existing navigation/collision adapter for pickup approaches. Keep input priority explicit in the clearing coordinator. Render loot through the shared native WebGPU pipeline with TSL/node materials, and project labels using the displayed unjittered camera. Do not introduce a separate render graph or backend. Drop animation follows the gameplay pause gates; landing eligibility remains simulation-owned rather than decided by a render callback.

Current consumable rewards retain their earlier quantities/chances; guaranteed equipment discoveries follow the area reward lists. Woodcutting and Mining attach XP provenance to contact drops; only successfully collected quantities award progress, and re-dropping resources never recreates that provenance. See [gathering and shelter](GATHERING.md). Scroll casting reserves one usable scroll against dropping during its two-second cast, preserving death precedence. [Economy](../src/gameplay/economy.ts) owns current Gold and Shop values; further economy balance remains future work. [Authored equipment](EQUIPMENT.md) owns current statistics and guaranteed discovery rewards. Pirata One is locally bundled with its license under `public/fonts/`.

## Implementation acceptance

Choose the relevant portion of these player flows when implementing, following [Development](DEVELOPMENT.md#commands-and-handoff). Equipment, materials, Health Potions and scrolls are available for current checks; gold and trading follow the focused flows below.

1. **Fight and collect:** defeat an enemy, watch its rewards toss and settle, and collect nearby supplies while combat remains active. Click equipment by label and by object; each request collects once, never attacks or auto-equips it.
2. **Chest and crowded loot:** open a chest, select individual rewards from separated name-only labels, and approach distant gear. Confirm hover identifies the matching object, including when scenery obscures it.
3. **Gather and overflow:** harvest Wood, Stone, and Iron through the same drop presentation. Fill a stack to 99, start another stack, then partially collect with limited space and retain the remainder. Gold increases the wallet without consuming slots.
4. **Cancel and fail an approach:** cancel with movement, attack, dodge, menus, death, or travel; replace the target with another drop. An unreachable item or full inventory gives brief feedback and preserves the loot without repeated automatic notifications.
5. **Travel, death, and restart:** leave drops behind, travel away, die and return, and find the same remaining loot. Restart preserves remaining ground loot and source renewal deadlines alongside collected progress.

Review crowded rewards and camera movement under the current gameplay lighting and normal zoom; expand to other zooms or scenery only for a concrete readability concern. Inspect Gothic readability, stable label placement, small-object recognition, and combat visibility; revise the weakest visible part before acceptance. New and materially rewritten tests must meet the [test admission and review policy](DEVELOPMENT_REFERENCE.md#testing-during-the-prototype-phase); loot changes do not automatically require tests. Finish implementation with the normal handoff gate and report unverified gameplay or visual behavior.

## Health Potions and two equipped sets

Health Potions are 1 × 1 supplies with stacks of 99. Their chest drops use the same toss, landing, 1.5 m auto-pickup, partial-transfer and session-retention rules as other supplies. New characters receive three; revisions 1–4 receive three once during migration, preserving any overflow. The clearing chest scatters two per session.

**F** uses one potion for an immediate 40 health and starts an 8-second shared cooldown. Full health, death, an empty supply or cooldown leaves the stack intact. Potion use does not cancel attacks, movement, dodge or a Return cast. The action bar's separate potion button shows quantity/cooldown, and the input is remappable.

Inventory's I/II tabs select which equipment set to edit. Both sets keep unique instances outside bag cells; an item cannot belong to both. Moving/removing a main hand displaces only that set's Shield, preserving the existing candidate-first/full-bag failure rules. Combat actions switch between compatible prepared sets; collected gear still never auto-equips.

## Shared equipment and discoveries

Helmet, Body, Gloves, Boots, two Rings, Amulet and Belt are shared across weapon sets. Their fixed catalog properties, slot comparisons, footprints, guaranteed clearing discoveries and revision 6 migration follow [combat and equipment](EQUIPMENT.md). Equipment-only caches need no guard metadata; the camp chest preserves its consumable rewards. All gear still requires explicit collection and never auto-equips.


## Gold and Homestead trading

`src/gameplay/economy.ts` owns fixed prices and the shared gold formula. `rollGold` returns zero for an opted-out source, an enemy without explicit `humanoid: true`, or a failed chance roll. Humanoid undead qualify; beasts do not. Chance is 50%/75%/100% for normal/elite/boss humanoids and 60% for chests. Successful quantities are `(random integer 3–5 + level − 1) × rank multiplier`, with enemy multipliers 1/2/5 and chest multiplier 1. Source `level` overrides area `level`, otherwise level 1 applies. Levels govern rewards only. Enemies support `rank`, `humanoid` and `gold`; chests support `level` and `gold`. Unspecified enemies are ineligible; unspecified chests remain eligible.

Adventure rolls independently of scrolls and equipment, once per defeated enemy life or chest opening, including failed rolls. Travel/death retain those opportunities and uncollected gold. Application restart preserves adventure areas and reward completion; individual renewal starts a new reward opportunity. Gold has a name-only muted-gold label and a small tarnished coin pile; it uses shared landing/reach rules and enters the wallet without bag space. Collected gold survives death, travel and restart. The current two-enemy clearing and camp chest average 6.4 gold before sales; other optional caches add their own chest opportunities. Broader outing balance awaits the expanded route.

Homestead's merchant stall is open from the start, independently of shelter restoration. Click the counter or merchant to approach within 1.8 m and open Shop. The paused menu shows Stock/Buyback beside the bag, selected-item stats/comparisons, fixed prices and the wallet. Gold also appears in Inventory. Each Buy purchases one item into the bag without equipping. Escape, Close, B or a click beginning and ending outside closes Shop and consumes gameplay input.

| Stock | Buy | Sell |
| --- | ---: | ---: |
| Health Potion | 5 | — |
| Sword / Bow | 60 | 15 |
| Shield | 40 | 10 |
| Quilted Coat | 80 | 20 |
| Trail Boots | 60 | 15 |

Stock is unlimited. Other sale values are fixed in the economy catalog: Leather Belt 10; Axe/Staff/Guard Helm 15; Weathered Mail/Duelist Gloves/Hearth Ring 20; Iron Signet/Amber Amulet 25; Iron Broadsword/Yew Longbow 30. Only unequipped bag equipment can be sold. Supplies, materials, equipped gear, stash and recovery overflow are excluded. Purchases do not mark adventure discoveries claimed; sales do not clear those claims.

Buyback retains the last ten sales, newest first, across travel/restart. An eleventh sale removes the oldest. Each entry retains its original item identity and paid sale value; Buy Back costs that value and restores the same item. All transactions validate shop reach/access, current ownership, stock, gold and capacity before committing. Failures change neither wallet nor inventory; successful trades save one coherent snapshot. Revision 7 adds gold and buyback, migrating earlier saves to zero gold and empty buyback without losing other progress. Buyback IDs participate in global container uniqueness and future ID allocation. Existing preservation/backup recovery applies to invalid saves.

For focused acceptance, collect gold with a full bag, return home, inspect stock/comparisons, buy a potion, sell and recover gear, then restart to verify wallet and buyback. Check rejected trades preserve both sides. Use the [lean workflow](DEVELOPMENT.md#working-alongside-other-agents); do not turn this into a full game replay.
