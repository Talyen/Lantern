# Item drops and pickups

Implementation acceptance follows the [lean task workflow](DEVELOPMENT.md#working-alongside-other-agents): inspect one representative loot interaction at normal gameplay scale. Alternate lighting/zoom and broader comparison scenarios below are optional targeted references.


The physical-drop system is implemented for enemy scrolls, the clearing chest's existing equipment/scroll rewards, harvested Wood/Stone/Iron, and player-dropped inventory items. Gold, potions, shops, armor, and equipment stat tradeoffs remain later milestone work.

The bag is a 12 × 8 grid. Sword uses 1 × 3 cells; Axe and Shield use 2 × 3; Bow and Staff use 2 × 4. Wood and Scroll of Return stacks use 1 × 1, stack to 99, and can occupy multiple cells. Each equipment copy has its own identity; equipped main/off-hand items occupy equipment slots instead of bag space. Item dimensions belong to `src/gameplay/inventory.ts`, alongside placement, transfers and packing.

Pickups auto-place without shuffling the bag. Drag to move, merge, equip or drop outside the panel; invalid moves and Escape cancel. Shift-click chooses an amount to split, then click its destination or the world outside the panel. Sort consolidates supplies and packs larger objects first, committing only when everything fits. Equipped-item displacement and asset/motion preparation must succeed before any equipment change commits. Player-dropped supplies wait until the player leaves their pickup radius and returns, or explicitly selects them.

Character save revision 4 retains the existing key, migrates previous equipment/resources/progress, and saves item copies, stacks, positions, equipment slots and individual chest claims. Legacy quantities beyond capacity remain in saved **Unpacked items**; select Collect to transfer what fits or drag/split them into the bag or world. Chest weapons are claimed on collection, so a restart can reoffer unclaimed rewards while preserving already collected claims. Dropping collected equipment does not reset its claim.

## Drops and collection

Enemies, chests, Woodcutting and inventory dropping use one shared ground-drop system. Mining uses this same owner; future world supplies must as well. Chests scatter their rewards onto the ground rather than depositing them directly into inventory. Woodcutting yields Wood; Mining yields Stone and Iron; Hide remains planned for enemies, chests, and supplies. Keep the first equipment rewards authored with useful tradeoffs; random affixes and rarity systems remain deferred.
