# Lantern UI design system

This is the canonical owner of Lantern's UI design direction and shared presentation rules. Read the [art direction](ART_DIRECTION.md#design-principles) for world identity, [runtime contracts](RUNTIME.md#hud-and-player-controls) for current behavior, and [design workflow](ui/WORKFLOW.md) for moving from a brief to an inspected screen. The [screen catalog](ui/SCREEN_CATALOG.md) tracks coverage; the [decision record](ui/DESIGN_DECISIONS.md) separates agreed direction from proposals.

## Status and intent

On October 2, 2026, the owner selected warm, crafted fantasy with restrained ornament, desktop keyboard/mouse first and A — Crafted instrument materials. After the layout/sketch/interaction studies, the owner explicitly authorized implementing Inventory and stash. These screens now use [InventoryPanel](../src/ui/inventory-panel.ts), [its style/token owner](../src/ui/inventory.css), [original item art](../assets/ui/inventory/PROMPT.md), and [the shared art renderer](../src/ui/inventory-art.ts). Continue focused guiding questions during implementation. Other screens remain in design until requested; this does not certify whole-game accessibility or quality.

Design from first principles of player goals, meaningful information and simple interaction. Do not preserve prototype UI elements or flows merely because they exist; many are rough or unintended. Read current models to understand available data, then recommend the best design and ask focused guiding questions at every consequential design step. The latest owner decisions below take precedence over earlier concept composition.

The quality ambition is the confidence, responsiveness and finish associated with excellent game and product interfaces. Achieve it through recognizable Lantern craft, readable decisions, predictable behavior and consistent feedback. A numerical quality score is not acceptance evidence. A still mockup cannot establish functional polish.

The player should know what matters, what they can do, what changed and how to leave. Combat remains visually primary during play. Menus feel like carefully made instruments from a dangerous world with warm refuge.

## Visual language

Use warm soot-charcoal reading surfaces, forged iron structure, worn brass accents, smoky glass and warm ivory type. Concentrate material character in useful item/ability art and a few panel joints. Keep text regions quiet and substantially opaque. The existing [orb artwork](../assets/ui/orbs/PROMPTS.md) is an optional material reference, not a requirement to preserve HUD shape or placement; discuss resource presentation from first principles.

Hierarchy should come from proportion, spacing, type, contrast and placement before ornament. One strong focal point per panel: the equipped loadout, carried items, a consequential decision or the active settings section. Inventory does not require persistent item selection or an inspector. Hover/focus, temporary carrying and valid destinations remain distinguishable.

Avoid excessive gold borders, constant glow, noisy text backgrounds, tiny decorative labels and ornament around every control. Keep Gothic character in short headings; use highly readable mixed-case labels, descriptions and numerals. Use familiar player-facing names. Do not add lore, slogans, explanatory panels or new mechanics to fill a composition.

The [initial Inventory concepts](ui/concepts/README.md) explore three material treatments. Crafted instrument is the material lead. After [layout exploration](ui/concepts/inventory-layouts/README.md), the owner preferred **one large split panel: 40% equipment/paper doll on the left, 60% inventory on the right**, with **subtle outline glyphs in empty equipment slots**. Detailed hierarchy, anatomical placement, art finish, interactions and responsive behavior remain under study. B/C remain material references. An image is never the source of truth for item data or interaction rules.

## Foundation specifications

All dimensions below are CSS pixels at UI scale 100%. Output pixel ratio remains 1 through the native WebGPU renderer; UI sizing is a separate presentation concern. Adopt exact runtime values through a reviewed implementation after the first functional prototype, then update these tables beside their code owner.

### Semantic color roles

| Role | Starting value | Use |
| --- | --- | --- |
| `surface.base` | `#171411` | Main reading surface |
| `surface.raised` | `#24201B` | Raised control or subpanel |
| `surface.inset` | `#100E0C` | Grid wells and recessed areas |
| `text.primary` | `#F0E6D2` | Labels, values, main copy |
| `text.secondary` | `#BEB19A` | Supporting information |
| `accent.brass` | `#C7A36A` | Selection and small craft details |
| `accent.amber` | `#E7AC65` | Main action emphasis |
| `focus.ring` | `#F6D89B` | Explicit focus outline |
| `border.quiet` | `#65533C` | Decorative separation only |
| `feedback.positive` | `#C0CD9B` | Positive signed change plus text/icon |
| `feedback.negative` | `#E3A38F` | Negative signed change/error plus text/icon |

These are seed values, not verified contrast pairs. Measure actual foreground/background pairs after opacity, imagery and states are composed. A quiet decorative border is unsuitable as the sole control boundary if that boundary is needed to identify the control. Health/mana colors describe resources; they do not replace success/error semantics. Do not introduce rarity colors before the equipment model owns rarity.

### Type, spacing and surfaces

| Foundation | Starting specification |
| --- | --- |
| Display face | Existing locally served Pirata One for short screen/item headings; review readability before wider use |
| Reading face | Current system sans-serif stack initially; consider another locally served licensed face only after side-by-side review |
| Type scale | 12 / 14 / 16 / 20 / 24 / 30 / 36; body 16, compact secondary 14, 12 reserved for short nonessential annotations |
| Line height | Body 1.4–1.5; headings 1.15–1.25; tabular numerals for values where supported |
| Spacing scale | 4 / 8 / 12 / 16 / 24 / 32 / 48; nested spacing follows information hierarchy |
| Panel padding | 24 standard, 16 compact; keep useful negative space rather than enlarging empty ornament |
| Corners | 2–4 on controls, 4–6 on panels; art frames can differ without changing hit geometry |
| Borders | Quiet 1px separators; stronger selection/focus treatments carry interaction meaning |
| Menu control size | 40px minimum intended hit area, 44px for main actions; small visual icons may sit inside larger targets |
| Inventory cells | Spatial bag with different footprints adopted; one shared item-art ruler across bag/equipment/carry; grid dimensions remain a design question |

The implemented spatial bag and stash use the current 12 × 8 model and different item footprints, without a save migration. All item contexts use one 48px ruler; the measured atlas bounds normalize original artwork once per identity. DOM text, hit geometry, focus and state chrome remain separate from raster art. [inventory.css](../src/ui/inventory.css) and [inventory-art.ts](../src/ui/inventory-art.ts) own exact implementation values.

**Grounded item scale:** the same item retains the same artwork scale in the bag, equipment slot and carried/drag representation. Accommodate its bounds/footprint in the slot; do not shrink it to fit a smaller equipment icon or enlarge it for inspection. No enlarged item preview or duplicated inspector artwork. Responsive layouts reflow instead of independently resizing items; an explicitly chosen whole-UI accessibility scale applies uniformly.

### Motion and sound

Use immediate input acknowledgment. Proposed timings: 80–120ms hover/press settling, 140–180ms menu transitions, and 180–240ms contained feedback. Input handling and access to controls must not wait for decorative animation. Resource movement and cooldowns follow gameplay clocks; motion must not imply a different cost or readiness time.

Avoid idle pulses, looping button shimmer and broad camera/screen motion for routine UI. Honor reduced-motion preferences; preserve state changes through immediate styling. Reuse the [audio cue owners](AUDIO.md) for restrained open/close/action feedback. Sound complements a visible result and is never the only indication. New sounds need a concrete interaction consumer and listening review.

## Layout and responsiveness

The adopted minimum supported game-content viewport is **1280 × 800 (16:10)**, matching [Valve’s Steam Deck display specification](https://www.steamdeck.com/en/tech). Common 16:9 and 16:10 desktop layouts are the primary range. This supersedes the briefly considered 1600 × 900 minimum. Steam Deck controller navigation, SteamOS/native-WebGPU operation and on-device performance remain future validation; minimum-size browser review is not device certification.

Inventory and stash retain one 48px CSS cell ruler across bag, equipment, storage and carry, with fixed authored item footprints and live text. The sheet fits the adopted minimum without shrinking item art; headers/close remain reachable and content scrolls when genuinely needed. No portrait/mobile layout or broad viewport matrix is implied. A whole-UI accessibility scale remains future design work.

For Inventory, develop the preferred **single 40/60 split panel: paper doll/equipment left, spatial bag right**. Equipment receptacles follow compact shared columns and row anchors while remaining relative to body regions. The Vitruvian-inspired person is a faint rough sketch used as background orientation only; no detailed anatomy, rendered model or dominant figure. Equipment/items are primary. Keep one item-art ruler while tightening spacing; empty slots use subtle outline glyphs. The unified toolbar holds actual main-hand glyphs with tiny I/II badges upper left, Sort toward upper right and Close far right. Continue detailed composition and responsive studies with guiding questions. Hover/focus supplies properties with no inspector/selection; carry is temporary. Stash and compact reflow need their own questions.

Stash replaces equipment on the left and keeps Bag on the right; it is a two-container sheet rather than a three-region view. Both grids remain visible at normal item scale, with independent toolbar Sort controls. Right-click transfers to the other container while stash is open; drag specifies a position. Inventory set icons both show and activate their chosen prepared set.

Keep Inventory about carried and equipped items. Woodcutting, Mining and Axe Combat/proficiency do not belong in an Inventory footer. Scroll of Return and Health Potions are items in the bag, not separate menu sections. Remove redundant category copy such as “Helmet” below “Guard Helm,” instructional paragraphs and nonessential status. Prefer recognizable icon controls, including an × close affordance, with accessible names and concise hover/focus labels when useful. Use text when it provides necessary identity or meaning that an icon alone cannot communicate.

The owner selected **loadout and quick gear exchange** as Inventory's priority, with equipped and carried items visible together; a **spatial bag with different footprints**; and **hover tooltips containing the name and useful properties only**. Do not automatically add comparison deltas, category labels or action instructions. Early layout studies may use 12 × 8 as a representative bag shape, not an adopted storage-size requirement.

HUD design should protect the central combat space and make urgent state legible. Ask which information needs persistent visibility, then explore resource shape/grouping, action readiness, supplies and weapon-set identity from first principles; do not inherit the prototype's orb/bar arrangement. Larger windows gain breathing room rather than larger empty bars. Compact layouts recompose around combat. Extra quest trackers, minimaps or meters need a player goal before design.

## Shared component contracts

[ui-tokens.css](../src/ui/ui-tokens.css) owns the shared semantic colors used by Inventory and Skills; each screen retains its authored layout and material gradients.

### Skills node direction

The owner selected an Inventory-sized Skills sheet with category tabs above and every skill in the active category visible in a bottom icon row. [The adopted six-step horizontal tree](ui/concepts/skills-horizontal/README.md) has two Basics, two Skills, two Ultimates and two smaller passive nodes between every pair of majors; Gathering/Crafting instead use generic Major/Minor placeholders. Each node has its own icon and hover/focus information; planned art retains identity beneath a small badge. A level ruler above the skill row marks 10/20/30/40/50 without an XP bar. Assignment uses the real gameplay bar outside the sheet: drag an existing action to it or activate an empty slot for its picker. No in-panel Assigned Abilities section. [SkillsPanel](../src/ui/skills-panel.ts) and [skills.css](../src/ui/skills.css) own the screen; current actions stay available and future nodes/thresholds remain planned.

Build these as small DOM/CSS patterns in the existing `src/ui/` boundaries, driven by current gameplay definitions. Introduce a shared primitive only when there is a concrete consumer; use Inventory and Options to prove reuse. A framework, Storybook installation or new UI dependency is not a prerequisite.

| Family | Contract |
| --- | --- |
| Menu shell | Clear identity, recognizable close/back icon with accessible name, useful content region; choose behavior from player needs |
| Button / icon button | Visible or accessible name; primary, secondary and consequential action roles; ordinary, hover, pressed, focus, disabled and pending states |
| Tabs / view switch | Selected state separate from focus; stable content relationship; real tab semantics only for a tab interaction model |
| Setting row | Useful label/value/control; choose live application or draft/Apply deliberately from player needs; keyboard adjustments and visible errors |
| Item cell / equipment slot | One artwork scale across bag/equipment/carry; equipped, hovered, focused, carried, valid/invalid destination and pending states; no persistent selection |
| Item tooltip | Hover/focus name and useful properties only; no automatic comparison, enlarged art, redundant category, instruction text or persistent inspector |
| Ability slot / skill choice | Assignment, lock reason, weapon compatibility, resource/cooldown state, binding label; readiness reflects gameplay |
| Tooltip / context prompt | Brief useful content on hover and focus; no critical action hidden exclusively in a tooltip; keep within viewport |
| Resource / progress | Name/value available without color; consistent number formatting; no distracting announcements every frame |
| Feedback / confirmation | Local explanation and recovery action; retain interaction context and player data on failure; reserve confirmations for real consequences |

Do not treat disabled, unavailable, locked and pending as one dimmed appearance. A pending mutation blocks duplicate submission, acknowledges the action and retains the correct item/destination context; success and failure resolve from the real owner, never an animation timer. Avoid hiding needed context by fading the entire component.

## Interaction and accessibility

Current [input ownership](RUNTIME.md#action-bar-and-input-ownership), [inventory commits](RUNTIME.md#inventory-commits) and [save recovery](RUNTIME.md#save-recovery) describe implementation, not constraints to preserve rough UI. Design pause/dismissal, navigation and settings application from player needs, with guiding questions and documented proposed changes. Event consumption, truthful mutations and retained player data remain required implementation safety. Do not attack through menus or manufacture mutation success.

The owner selected direct item actions plus drag: right-click a consumable to use; right-click bag gear to equip; right-click equipped gear to unequip. Drag moves items or equips at an explicit destination. Right-clicking a bag ring fills an empty slot first (left first when both empty), otherwise replaces left; drag can explicitly replace right. No ring-slot choice UI. Replaced gear automatically returns to vacated bag space when it fits, otherwise another free space; block the swap safely with brief local feedback if none exists. Quantities, weapon-set viewing, drop behavior and keyboard equivalents remain design questions. No persistent inspector or instructional prose.

For new implementations, define initial focus, visible focus order, close/back behavior and return focus explicitly. Escape cancels the current transient interaction before leaving the owning screen where that behavior applies. Dragging retains a click/keyboard operation for the same player goal; provide clear destination/quantity and cancellation. Gamepad planning includes directional focus, confirm, back, scrolling and alternate operations, but does not add controller support until the input owner implements it.

Target WCAG 2.2 AA menu guidance: ordinary text contrast at least 4.5:1; large text and required non-text state/control identification at least 3:1. Use a stronger Lantern target for menu hit areas than the 24px WCAG minimum where layout permits. Selection, gains/losses, invalid placement and cooldown availability need shape/text/value cues as well as color. Keep overlays readable over bright and dark world imagery. Screen-reader menu names, values and meaningful status updates are part of component design; continuously changing combat values need an intentional announcement policy. These targets do not assert whole-game WCAG conformance.

Primary references: [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), and [minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Treat them as concrete design constraints, then inspect the actual implementation.

## Design phase and eventual adoption

Inventory/stash implementation is authorized and follows the managed workflow. First-principles [design exploration](ui/DESIGN_EXPLORATION.md) continues for later screens and remaining questions. Do not infer that one implemented screen approves all HUD/menu layouts.

When the owner explicitly requests implementation, the proposed adoption sequence is:

1. Translate the chosen layout/hierarchy/state specifications into a development-only DOM component specimen with fixed representative data, isolated from saves/gameplay, then one functional Inventory vertical slice.
2. Extract proven semantic tokens and shared menu/control patterns beside `src/ui/`; implement the chosen Inventory/stash design with safe data operations and documented model changes.
3. Apply those patterns to HUD/action bar and Skills, then Options/Keybindings. Refine at gameplay scale with one relevant interaction per task.
4. Finish travel, shelter, loot/context prompts, outcomes, startup/loading and save-error/recovery presentation. Extend to shops/Smithing and future screens when their gameplay owners are ready.

The [workflow](ui/WORKFLOW.md) defines the brief, mockup records and acceptance. New screen work updates its catalog row and relevant decisions. Shared tokens/components must have one code owner and documented consumers; avoid per-screen copies of foundation values. Keep developer authoring/labs identifiable and functional with shared readability primitives, while player screens receive the game treatment.

Definition of completion: the intended task works; the screen has a coherent hierarchy; relevant states and input paths are usable; the changed responsive case retains accessible actions; the weakest visible part has been inspected and refined; and the lean sanity gate passes. Report material limits directly. Whole-game polish remains an ongoing migration, not a claim attached to this foundation.
