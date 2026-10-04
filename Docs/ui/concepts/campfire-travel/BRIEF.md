# Campfire Travel

## Adopted direction — October 4, 2026

The player wants to return to a discovered fire quickly while keeping their character and surroundings visible. The owner selected a left-side panel, following Diablo II's waypoint placement, and layout C from the preview-only hierarchy comparison: the current fire's authored name is the heading, with **Campfire Travel** beneath it. There is no “At:” prefix or current-location row. No new runtime art is required.

The compact 360px panel sits 24px from the left edge, centered above the HUD, with a light backdrop, quiet charcoal reading surfaces, worn brass accents and ivory text. Only other discovered destinations appear, in the travel owner's existing order. The destination list scrolls when necessary; the heading and close control stay visible. The minimum review target is 1280 × 800.

## Interaction

- Enter through a safe campfire's normal click-to-approach interaction. Opening clears held inputs and pauses simulation.
- Focus the first destination on opening. Up/Down wraps through destinations; Tab/Shift+Tab reaches all controls. Click, Enter or Space starts travel directly, with no confirmation step. Repeated activation cannot start another trip.
- Escape, × or a click that starts and ends outside closes the menu, clears input and returns focus to play.
- With no other discovered fires, show “No other campfires discovered.” and focus Close.
- The shared transition acknowledges pending preparation and reveals a settled arrival. Existing precommit Retry/Back recovery and eligibility rechecks remain authoritative. Unsafe source fires retain their silent non-interactive behavior; destination enemies do not prevent travel.

## Owners and acceptance

[Adventure menus](../../../../src/ui/adventure.ts) own the presentation and keyboard handling; [interaction actions](../../../../src/clearing/interaction-actions.ts) supply the source name and eligible choices. [Travel safety](../../../RUNTIME.md#travel-and-fire-safety), [shared styling](../../../../src/ui/game.css), the [UI design system](../../../UI_DESIGN.md) and [interaction feedback](../../../INTERACTION_FEEDBACK.md) retain their ownership.

Inspect one owned normal-settings preview at 1280 × 800: character visibility, focused destination, cancellation/focus return, empty state and one successful campfire trip. Review the task diff and integration sanity gate. No new automated test or performance measurement is implied; platform/controller and whole-game accessibility acceptance remain separate.
