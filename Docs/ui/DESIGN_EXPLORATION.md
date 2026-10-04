# Active UI design exploration

**Current phase:** Inventory/stash, Skills, orb-led HUD, shared loading and current-menu polish are implemented; [the screen catalog](SCREEN_CATALOG.md) tracks inspection and remaining design gaps. The earlier no-prototype hold was lifted for requested implementations. Continue first-principles design and focused guiding questions for unresolved surfaces; do not infer approval of new screen families.

The owner prefers **A — Crafted instrument** for materials. That choice does **not** approve A's organizational layout. The original three-column organization was superseded by the adopted 40/60 split after multiple layout studies. See the [decision record](DESIGN_DECISIONS.md), [foundation](../UI_DESIGN.md), and [Inventory layout round](concepts/inventory-layouts/README.md).

The owner explicitly requested first-principles design rather than preserving prototype UI, with guiding questions and recommendations at every step. Treat source as an inventory of available data, not a template. Ask a few focused questions for the current decision, explain the recommendation, explore alternatives and incorporate the answer before the next consequential design choice.

Inventory constraints adopted from owner feedback: equipment slots surround an illustrated person silhouette; one artwork scale across bag/equipment/carry; hover tooltips instead of persistent item selection/inspection; icon controls where clear; direct item actions such as right-click use; no gathering/proficiency footer, separate return-scroll section, redundant category labels or random instructions. Earlier mockups with those elements are superseded.

Guiding-question answers: prioritize loadout/quick gear exchange with equipment and bag visible together; use a spatial bag with different footprints; tooltip contains name and useful properties only, without automatic comparison. Layout studies compare arrangements of those functions while exact grid dimensions remain open.

After reviewing layout families, the owner chose #1, 40% equipment left / 60% inventory right, outline empty glyphs, grid-like body-relative receptacles and a faint rough sketch background. The owner then authorized implementation of that direction.

Further direction: tighter slots around an artistic Vitruvian-inspired figure sketch; upper-left toolbar set icons show each main-hand weapon plus a tiny I/II badge, and Sort moves into the toolbar. Right-click uses/equips/unequips; drag chooses placement. Rings fill empty slots first, otherwise replace left; drag can replace right, with no choice UI. Replaced gear returns to vacated/free bag space automatically, otherwise the swap is blocked safely with brief local feedback. Set icons now show and activate the prepared set; item scale and the minimum viewport follow the implemented Inventory owners. Further visual refinement and wider accessibility remain open.

Latest composition direction: slots use tidy shared columns and row anchors, still relative to body positions. The paper doll becomes a faint rough sketch in the background rather than detailed anatomy or a visual focal point. Preserve item-art scale; neat organization comes from alignment and spacing.

## Questions before committing to a screen

| Dimension | Questions to answer through design |
| --- | --- |
| Player intent | Is this visit about finding an item, comparing/equipping, organizing supplies, or transferring storage? What deserves first attention in each context? |
| Information hierarchy | What must remain visible, what appears on hover/focus, and what can sit one view away? Does a compact layout hide useful equipment context? |
| Organization | Paired paper-doll/bag regions, central silhouette with side wings, stacked composition or anchored panels? What does each choice make easier/harder? |
| Density and proportion | How much room belongs to the paper doll, spatial bag and useful hover properties at consistent art scale? Which necessary text can wrap? |
| Navigation and flow | How does the player enter, hover/focus, act directly, carry to a destination, cancel and return? What changes when opening from a stash? |
| Feedback and states | What is visible while hovering, focusing, carrying, pending, failing or reaching capacity? What keeps an operation and its destination unambiguous? |
| Responsive composition | How does the hierarchy survive short windows, compact widths and larger text? Which regions reflow versus become explicit views? |
| Cohesion | Which shell, typography, icons and state cues should repeat across HUD, Inventory, Skills and Options, and where should the task change the composition? |

## Exploration rounds

1. **Breadth of organization:** compare genuinely different spatial/nav structures with equivalent representative data. The current Inventory round explores paper-doll/bag arrangements. Material stays in A's family so layout can be judged separately.
2. **Hierarchy within promising layouts:** prioritize the adopted loadout/gear-exchange goal while exploring region proportions, tooltip placement and navigation. Tooltips contain name/useful properties only. Remove information unrelated to the screen's player goal. No layout is final just because one image looks attractive.
3. **Composition and density:** explore compact versus spacious, icon-forward versus value-forward, and selective material/ornament. Preserve readable live-text intent and actual item rules. Use targeted revisions rather than quietly blending all options together.
4. **Responsive layout sheets:** show a chosen family at wide, short and compact windows. Discuss which information remains simultaneous and what becomes a switch/inspection view. These are design targets, not support certification.
5. **Interaction storyboards:** draw hover-properties/direct-equip, right-click consumable use, drag/equip, split/carry/cancel, stash transfer, settings and binding-conflict flows. Show ordinary/hover/focus/carry/pending/error states. Current model restrictions inform design; proposed changes are explicit. Static storyboards establish intent, not tested usability.
6. **Cross-screen family studies:** explore HUD/action-bar organization, Skills/assignment, Options/Keybindings, travel/home and outcomes using the emerging vocabulary. Add future shop/crafting layouts when their gameplay requirements are current. Components get coordinated family sheets, not unrelated skins.
7. **Consolidation when requested:** collect preferred layouts, remaining questions, chosen component treatments and state/flow specifications into the canonical design system. The owner decides when to move to a functional prototype.

These rounds are a menu for sustained design work, not a fixed quota, deadline or automation. Continue the useful design work authorized in the conversation, show meaningful alternatives and incorporate feedback. The owner requested guiding questions and recommendations at each design step; use focused questions to help shape the next study without asking permission for routine design work.

## Compare options concretely

For each option, record the player task it prioritizes, the information visible simultaneously, the extra navigation it introduces, the likely compact-window weakness and the open questions. Explain tradeoffs as design hypotheses; do not claim faster use or higher usability without observation. Keep the content constant where possible and label any content drift in generated images.

Use familiar screen identity, meaningful properties and simple direct actions. A view switch or split carried-item compartment is a proposed organization change; document any underlying model implication. Equipment and bag stay visible together for the adopted Inventory goal. Do not infer approval of hierarchy or interaction from approval of texture/material.

Save each round's exact prompts, outputs, provenance and critique beside its README. The [screen brief template](SCREEN_BRIEF_TEMPLATE.md) supports layout/flow notes; the [screen catalog](SCREEN_CATALOG.md) records concepts and unresolved decisions. Concept-only work needs links/diff review and no gameplay preview or benchmark. Authorized implementation uses its focused owned interaction and lean sanity gate; Inventory/stash are now in that phase.
