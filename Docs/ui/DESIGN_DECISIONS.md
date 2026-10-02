# UI design decisions

Use [the design system](../UI_DESIGN.md) for shared rules and [the workflow](WORKFLOW.md) for evidence. Update a decision when an answer or inspected prototype resolves it. Keep adopted, proposed and deferred decisions distinct. Dates below use the project owner's local date.

## Agreed direction — October 2, 2026

| Decision | Status | Basis and implication |
| --- | --- | --- |
| Warm, crafted fantasy with restrained ornament | Adopted by owner | Explicit choice; extend Lantern's warm grimdark, iron/brass/smoky glass and amber refuge |
| Desktop keyboard/mouse first | Adopted by owner | Explicit choice; prioritize readable desktop interactions |
| Plan gamepad and smaller windows | Adopted by owner | Include focus/back/alternate-operation design and compact layout studies; implementation/support remains outstanding |
| All screens/components should converge on a shared system | Requested by owner | One reusable vocabulary and screen migration process; no numerical quality certification |
| Original ImageGen mockups for screen/layout direction | Requested by owner | Save prompts, images, critique and decision status; verify interactions in DOM prototypes |

The native-only WebGPU pipeline, current game mechanics, authored item catalog and private-art boundaries remain owned by their existing guides. Design work follows those contracts.

## Decisions to resolve next

| Decision | Recommendation | How to decide | Status |
| --- | --- | --- | --- |
| Material weight | Crafted instrument: quiet surfaces, thin brass, selective iron joints | Compare [A/B/C Inventory concepts](concepts/README.md); select what to keep/remove | Proposed |
| Heading/reading typography | Pirata One for short headings, readable sans for controls and numbers | Inspect title, item name, long label and stat row at gameplay scale | Proposed |
| Icon finish | Original painterly item/ability art with shared silhouette/padding/light; DOM text and code-owned state chrome | Compare several representative icons at actual slot size; respect licensed-art provenance | Proposed |
| Inventory information hierarchy | Equipment / spatial Bag / selected item; properties and comparison next to actions | Select and equip one existing item; verify the comparison target is unmistakable | Proposed |
| Compact layout | Details reflow below or into explicit inspection; Bag/Stash switch when both grids do not fit | Study 1280 × 720 and one concrete smaller-window uncertainty | Proposed |
| Minimum window/UI scale | Initial 1280 × 720 target; study 100/125/150% UI scale | Functional layout review; decide compact minimum from observed usability | Proposed; not support certification |
| HUD density | Keep orbs, six action slots, supplies and weapon-set state; protect central play space | One short fight plus one ability readiness/utility interaction | Proposed |
| Accessibility scope | Menu contrast, visible focus, keyboard paths, larger targets, reduced motion and color-independent state as baseline | Validate changed component pairs and one representative input flow; record wider gaps | Proposed; conformance unverified |
| Navigation architecture | Keep familiar separate menu names initially; share shell/back behavior | Inspect Inventory → close → Options → Keybindings; do not add a hub without a discoverability need | Proposed |
| First implementation | Development-only fixed-data specimen + Inventory vertical slice | Reuse shell/buttons/item states, then prove a real equip operation | Proposed |

No additional identity decision is required before generating these concepts. Routine implementation choices within the adopted direction may proceed through the task workflow; ask the owner when changing identity, input/platform priorities, or consequential gameplay behavior.

## Deferred scope

Touch/mobile, console certification, a new UI framework, general character levels, rarity tiers, quest trackers and minimaps are not implied by the design request. Shops, Smithing, proficiency unlocks and future front-end screens receive design coverage when the [roadmap](../../ROADMAP.md) and their gameplay owners establish requirements. Concurrent work can advance those owners; refresh the catalog before implementing them.

## Decision entry format

For a consequential change, append a short dated entry with: question; adopted choice; owner/evidence; affected tokens/components/screens; remaining uncertainty. Link the exact prompt/concept or prototype evidence. Rewrite the active recommendation when it changes, rather than leaving conflicting prescriptions. Keep routine visual tuning beside the owning component instead of producing a decision entry for every pixel.
