# Inventory direction studies — October 2, 2026

These original mockups compare material weight within the owner's chosen **warm, crafted fantasy with restrained ornament** direction. The same Inventory goal and three-region Equipment / Bag / Details hierarchy were requested in all three. They are concepts for discussion, not runtime screenshots, exact layout specifications or production assets. See [decisions](../DESIGN_DECISIONS.md) and [the design system](../../UI_DESIGN.md).

## Comparison and recommendation

| Concept | Useful direction | Refinement needed |
| --- | --- | --- |
| A — Crafted instrument | Thin brass, coordinated warm surfaces and recognizable fantasy heading/item art; strong selected-item focus | Reduce oversized heading and repeated framing; calm the primary button and use B's lighter reading-surface treatment |
| B — Quiet glass | Less framing, smaller title and quieter controls; clear separation without a heavy decorative shell | Selection glow is too strong; mostly matte output does not establish the requested smoky-glass response; retain stronger Lantern craft at a few joints |
| C — Forged cabinet | Cohesive physical structure, restrained primary action, empty equipped Helmet slot makes selected-item context clearer | Corner joints/dividers dominate and wrapped equipment labels are awkward; reduce structure and give labels more space |

**Recommendation, pending owner selection:** A's crafted identity with B's calmer framing and smaller title. Carry forward the common equipment/bag/detail hierarchy, then settle exact spacing and text in the functional prototype. C is a useful reference for selective structural joints, rather than a frame around every region. None of the three should be traced pixel-for-pixel.

All outputs diverge from exact product content: multi-cell footprints/grid geometry need rebuilding from the model, several icons are invented examples, A includes blue potions that Lantern does not currently own, and A/B imply a selected helmet is also equipped. Some ornament and selection glow exceed the restraint goal. The generated footer omits real progress values; real loadout stats/comparison, stack counts, pending/error and keyboard-focus states are not shown. These are gaps for the brief/prototype, not instructions to remove those features. No generated typography or stat copy is adopted as production data.

## A — Crafted instrument

![Original Inventory concept A: thin brass frame, equipment rail, spatial bag and selected helmet detail](inventory/a-crafted-instrument.png)

[Exact prompt A](inventory/a-prompt.md). Built-in ImageGen; text only; no reference image.

## B — Quiet glass

![Original Inventory concept B: quieter panel borders and a smaller centered title](inventory/b-quiet-glass.png)

[Exact prompt B](inventory/b-prompt.md). Built-in ImageGen; text only; no reference image.

## C — Forged cabinet

![Original Inventory concept C: darker tactile panels and selective structural iron joints](inventory/c-forged-cabinet.png)

[Exact prompt C](inventory/c-prompt.md). Built-in ImageGen; text only; no reference image.

## Provenance

All three PNGs are 1672 × 941 pixels, copied unchanged from built-in ImageGen outputs. No Synty/Mixamo model, texture, render, game screenshot or third-party reference was supplied. These files live in documentation, outside `public/` and runtime imports. Original content follows the [project license](../../../LICENSE.md). The precise prompts above preserve requested content and each variation.

| File | SHA-256 |
| --- | --- |
| `inventory/a-crafted-instrument.png` | `932dd09d899f848bdfdd968edbd8845b48f69b49afa3ac88cba396f30bbb6e92` |
| `inventory/b-quiet-glass.png` | `8d6e2259a916b7db2e89dad1480efc4db24ca3c9b342e68f553eb0ff75e58f27` |
| `inventory/c-forged-cabinet.png` | `c4159aafb5150ab93cdc07e45323dfa7f85682e3c539afdc09a63c750fb477c4` |

The [first Inventory brief](inventory/BRIEF.md) specifies the next functional slice and the current rules it must preserve. Next evidence: owner material preference, compact layout study, fixed-data DOM component states and one real select/compare/equip flow. No gameplay, responsive, accessibility, controller or cross-platform inspection was performed in this concept task.
