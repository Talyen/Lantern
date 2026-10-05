# Inventory design brief

Status: implementation authorized after concept review, October 2, 2026. [InventoryPanel](../../../../../src/ui/inventory-panel.ts) now implements the preferred design; [styles](../../../../../src/ui/inventory.css) and [art](../../../../../src/ui/inventory-art.ts) own exact presentation values. Continue guiding questions for unresolved behavior and future screens.

## Player goal

Prioritize understanding the equipped loadout and quickly exchanging gear, with equipment and carried items visible together. Design an intentional warm crafted interface from player needs, not the rough prototype layout or flows. Ask guiding questions with recommendations at every consequential design step.

## Adopted constraints

- Equipment slots use a tight, tidy grid-like organization relative to body regions. The Vitruvian-inspired person is only a faint rough background sketch, with minimal detail and no rendered-model quality. Slots/items are primary; tighten alignment/gaps without shrinking art.
- Spatial bag with different item footprints. Each item's artwork scale remains identical across bag, equipment and carry. Accommodate its footprint instead of shrinking equipped art; no enlarged inspection copy.
- Hover tooltips show the name and useful properties only; also available on keyboard focus. No automatic comparison, redundant category line or instructional text.
- No persistent item selection or selected-item inspector. Carry/drag is an active temporary interaction.
- Unified toolbar: actual main-hand weapon glyphs with tiny I/II badges upper left, Sort toward upper right and Close far right, with accessible names. Keep necessary identity/value text.
- Direct right-click consumable use / bag gear equip / equipped gear unequip, plus drag placement. A ring fills an empty slot first, otherwise replaces left; drag explicitly replaces right. No ring-slot choice UI. Replaced gear returns to vacated/free bag space automatically; safely block when none exists. Set icons show and activate together; Enter is the primary action, Space picks up, arrows move the carry, and Escape cancels.
- No Woodcutting/Mining/Axe Combat footer, unrelated progression/status, separate Scroll of Return section, Equip/Use action rows or random instructions. Scrolls and potions live in the bag as items.

## Available data, not inherited UI requirements

[Equipment catalog](../../../../../src/gameplay/equipment.ts) and [inventory model](../../../../../src/gameplay/inventory.ts) describe current items/properties/footprints. [Inventory controller](../../../../../src/session/inventory.ts) and [adventure UI](../../../../../src/ui/adventure.ts) show existing operations. Use this information to ground examples; do not preserve prototype UI or unintended behavior. Proposed changes to storage or gameplay rules are explicit questions.

Representative examples: Sword 1×3, Bow 2×4, Shield/Mail 2×3, Guard Helm/Gloves/Boots 2×2, Ring/Amulet 1×1, Belt 2×1, supplies 1×1. Guard Helm has Armor +8. The original studies used 12×8 illustratively; implementation now retains the current 12×8 bag/stash model with one 48px artwork ruler. Concepts do not authorize changing storage capacity.

## Open design questions

The owner preferred #1's family: one large split panel, 40% paper-doll/equipment left and 60% spatial inventory right, with subtle outline glyphs in empty slots. Continue body-slot association, art-scale/finish, weapon-set viewing, tooltip/direct-action behavior, overflow, responsive and stash studies without permanent information panels.

Stash uses Stash left / Bag right and no equipment, with right-click transfer. Minimum supported content viewport is 1280 × 800; physical Steam Deck/controller validation remains future work. Item scale remains constant across all contexts.

## Concept acceptance

Save original outputs, exact prompts/provenance and specific critique. Record useful elements, generated drift and unresolved questions; review documentation links/diffs and the lean integration sanity gate. The original concept acceptance required no gameplay preview or prototype build; implementation now follows the focused gameplay acceptance in the UI workflow. No measurements are implied. Do not claim precise artwork parity, functional usability, accessibility, controller or window support from a generated image.
