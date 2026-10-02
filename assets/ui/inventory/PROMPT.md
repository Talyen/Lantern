# Inventory item atlas

Original built-in ImageGen generation, October 2, 2026. Text-only input; no Synty/Mixamo model, texture, render or third-party reference supplied. Transparent RGBA output copied unchanged into `item-atlas.png`. The actual output is 1254 × 1254; requested tile spacing was not exact, so [the art renderer](../../../src/ui/inventory-art.ts) owns measured alpha bounds for all 21 objects. It uses one canonical size per item across bag, equipment and carry. No generated labels or interface chrome are consumed.

Original content follows the [project license](../../../LICENSE.md). Replacing the atlas requires updating its measured bounds and re-inspecting the affected art at gameplay scale. Vite bundles the explicit runtime import; this is original UI art, separate from private vendor imports.

SHA-256: `96868fc3864b2f87fb99967b65678e1f8e8130ca585298acdc505ad581628b32`.

## Exact prompt

```text
Use case: stylized-concept.
Asset type: production original fantasy RPG inventory item SPRITE ATLAS, transparent background. One square 5-column by 5-row atlas, request 2000x2000, equally spaced 400x400 cells, no grid lines.
Primary request: 21 individually separated grounded medieval inventory item illustrations with painterly craftsmanship, original designs, warm worn iron/brass/leather/wood, amber/crimson details. Same directional upper-left lighting, near-front orthographic inventory perspective, quiet restrained highlights, no environment. Fully isolated transparent shapes. No licensed artwork supplied or imitated.
Exact cell ordering, left-to-right, top-to-bottom:
Row 1: simple one-handed Sword; heavier Iron Broadsword; wood-handled Axe; simple wooden Bow; thicker Yew Longbow.
Row 2: wooden magic Staff with a small amber inset; iron-and-wood Shield; Guard Helm (closed iron helmet); Weathered Mail (chainmail torso); Quilted Coat (brown padded torso).
Row 3: Duelist Gloves (a pair of leather gloves); Trail Boots (a pair of leather boots); Iron Signet (plain iron signet ring); Hearth Ring (warm red-stone brass ring); Amber Amulet (small amber pendant and short chain).
Row 4: Leather Belt (horizontal strap and iron buckle); Health Potion (corked small flask with crimson liquid); Scroll of Return (rolled parchment tied with muted red cord); Wood (three modest split logs); Stone (three rough mineral chunks).
Row 5: Iron (three small iron ingots); EMPTY; EMPTY; EMPTY; EMPTY.
Respect rows and columns strictly. Every item entirely within its own cell, centered; generous transparent separation. Use an 80px-per-logical-cell physical art ruler inside the 400px tiles: sword 1x3 logical cells, axe/shield/mail/coat 2x3, bows/staff 2x4, helmet/gloves/boots 2x2, rings/amulet/potion/scroll/wood/stone/iron 1x1, belt 2x1. Thus rings/potions/supplies are small, blades/bows long. No giant ring or potion filling its tile. Render enough detail for polished UI at 40–160 displayed pixels.
NO text, names, numbers, item frames, borders, icons for controls, cell dividers, drop shadows outside shapes, mannequin or character, logo, weapon trails, glow effects or backdrop. True transparent background including between all items. This is one atlas, not a screenshot, grid diagram or contact sheet with labels.
```
