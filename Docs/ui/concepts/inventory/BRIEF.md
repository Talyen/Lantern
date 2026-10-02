# First Inventory design brief

Status: concept and proposed functional slice, October 2, 2026. The owner selected A — Crafted instrument as the lead material treatment. See [A/B/C concepts and critique](../README.md), [decisions](../../DESIGN_DECISIONS.md) and [shared foundations](../../../UI_DESIGN.md).

## Player goal and visible effect

The player identifies an item in the spatial Bag, understands its properties and equipment tradeoff, and confidently equips it into the intended weapon set or shared slot. Quiet warm surfaces, deliberate spacing, small brass selection cues and coordinated item art create the feeling of a carefully crafted instrument. The selected item and its meaningful action receive emphasis; structural ornament stays subordinate.

Owners: [AdventureMenus](../../../../src/ui/adventure.ts), [markup](../../../../index.html), [inventory controller](../../../../src/clearing/inventory.ts), [inventory model](../../../../src/gameplay/inventory.ts), [equipment catalog](../../../../src/gameplay/equipment.ts), and [menu controller](../../../../src/clearing/menu-controller.ts). Read their consumers before implementation. Current rules are in [inventory commits](../../../RUNTIME.md#inventory-commits) and [input ownership](../../../RUNTIME.md#action-bar-and-input-ownership).

## Information hierarchy

1. Header: Inventory and a predictable Close action.
2. Equipment: two weapon-set views, Main/Off hand and eight shared armor/accessory slots. Viewed set and currently active set remain distinct; inspecting a tab must not imply swapping combat equipment.
3. Bag: exact 12 × 8 lattice, authored item footprints and quantities, visible selection; Sort is a secondary action.
4. Detail: selected item identity/properties, comparison target and signed deltas, then only currently applicable actions. Use real catalog/save values, including two-handed and ring-destination rules.
5. Secondary status: loadout summary, skill/Rested information, supplies and overflow recovery remain available with restrained emphasis. Their existing presence must not be erased because a concept omitted them.

For the concept state, Guard Helm is selected in the Bag; its catalog bonus is Armor +8. The actual comparison is derived from the currently equipped helmet, so +8 is not automatically the loadout gain. Other mocked art is illustrative and must be mapped to real item IDs before runtime use.

## Flow and states

Enter through the current Inventory binding or stash interaction, preserving pause and cleared input. Select, inspect, choose a legitimate destination and submit through the existing inventory owner. Confirm through actual equipment/model update; retain selection and recoverable error context on failure. Close consumes UI input and returns control to play through the existing controller.

The first real slice exercises select → compare → equip → close. Shared cells/buttons must also define hover, visible keyboard focus, selection, equipped/empty slot, unavailable action and pending/failure treatment. Broader bag/stash migration retains transfer, split/carry/cancel, invalid placement, capacity/overflow recovery and drop semantics. Drafting these states does not claim current keyboard parity; alternate operations and return-focus behavior are implementation work.

Use click/keyboard item actions to complement dragging. Escape cancels the current split/carried interaction before closing where the current owner does so. Pending equipment work must retain the current duplicate-submit and commit safety. UI selection must not activate the world attack bound to the same input.

## Layout study

Wide: Equipment / Bag / Details, compact loadout/status rows, stable header. Starting review view is 1440 × 900; 1280 × 720 is the proposed minimum. Reflow the detail region below or into explicit inspection when three columns no longer fit. Keep actions reachable with a stable content-scroll area and readable labels; preserve selected item while resizing.

Stash extends this same system with two exact grids and a clear destination. Use a Bag/Stash switch when simultaneous grids become cramped. This is a proposed UX behavior to implement and inspect, not an existing switch. Resolve 960 × 640 and enlarged UI as targeted compact studies before claiming support.

## Decision and acceptance

Refine A's material treatment, then resolve heading size, icon finish, detail placement and compact behavior. First implement a fixed-data specimen sharing the actual component code, then the real Inventory slice; document its entry point when created. Avoid a screenshot-shaped implementation or a second set of demo components.

Acceptance evidence for that slice: one normal-settings owned preview, one real select/compare/equip/close flow, one relevant compact-layout concern if that behavior changes, refinement of the weakest visible detail, and the lean integration sanity gate. Preserve actual item rules and persistence. Record unresolved keyboard/gamepad, accessibility, window-size and platform limits in the coverage entry.
