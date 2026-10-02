# Lantern UI design system

This is the canonical owner of Lantern's UI design direction and shared presentation rules. Read the [art direction](ART_DIRECTION.md#design-principles) for world identity, [runtime contracts](RUNTIME.md#hud-and-player-controls) for current behavior, and [design workflow](ui/WORKFLOW.md) for moving from a brief to an inspected screen. The [screen catalog](ui/SCREEN_CATALOG.md) tracks coverage; the [decision record](ui/DESIGN_DECISIONS.md) separates agreed direction from proposals.

## Status and intent

On October 2, 2026, the owner selected **warm, crafted fantasy with restrained ornament**, with **desktop keyboard/mouse first, gamepad and smaller windows planned**. These choices guide new UI work. The foundation values below are proposed starting specifications, pending functional prototype review. Existing screens have not yet been migrated and this document does not certify their accessibility or quality.

The quality ambition is the confidence, responsiveness and finish associated with excellent game and product interfaces. Achieve it through recognizable Lantern craft, readable decisions, predictable behavior and consistent feedback. A numerical quality score is not acceptance evidence. A still mockup cannot establish functional polish.

The player should know what matters, what they can do, what changed and how to leave. Combat remains visually primary during play. Menus feel like carefully made instruments from a dangerous world with warm refuge.

## Visual language

Use warm soot-charcoal reading surfaces, forged iron structure, worn brass accents, smoky glass and warm ivory type. Concentrate material character in resource orbs, item/ability art, selected details and a few panel joints. Keep text regions quiet and substantially opaque. Follow the existing [orb treatment](../assets/ui/orbs/PROMPTS.md); keep health crimson and mana blue as distinct resource identities.

Hierarchy should come from proportion, spacing, type, contrast and placement before ornament. One strong focal point per panel: selected equipment, a consequential decision or the active settings section. Reserve the strongest amber emphasis for the main available action. Persistent selection, temporary hover and keyboard focus must remain distinguishable.

Avoid excessive gold borders, constant glow, noisy text backgrounds, tiny decorative labels and ornament around every control. Keep Gothic character in short headings; use highly readable mixed-case labels, descriptions and numerals. Use familiar player-facing names. Do not add lore, slogans, explanatory panels or new mechanics to fill a composition.

The [initial Inventory concepts](ui/concepts/README.md) explore three treatments within this direction. Their material/layout details remain candidates, including the recommended Crafted instrument treatment. An image is never the source of truth for equipment slots, item data or interaction rules.

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
| Inventory cells | Start at 32–40px; keep the exact 12 × 8 lattice and authored multi-cell footprints |

The inventory-cell target is provisional at compact sizes; do not silently shrink cells or text until they fit. Resolve the layout, scroll or supported minimum instead. Keep text live in the DOM. Generated typography and glyphs are visual reference only. Item and ability art should share silhouette, light direction, padding and edge treatment, with icon art distinct from actionable control chrome.

### Motion and sound

Use immediate input acknowledgment. Proposed timings: 80–120ms hover/press settling, 140–180ms menu transitions, and 180–240ms contained feedback. Input handling and access to controls must not wait for decorative animation. Resource movement and cooldowns follow gameplay clocks; motion must not imply a different cost or readiness time.

Avoid idle pulses, looping button shimmer and broad camera/screen motion for routine UI. Honor reduced-motion preferences; preserve state changes through immediate styling. Reuse the [audio cue owners](AUDIO.md) for restrained open/close/action feedback. Sound complements a visible result and is never the only indication. New sounds need a concrete interaction consumer and listening review.

## Layout and responsiveness

Proposed first targets are desktop 1920 × 1080 and 1440 × 900, with 1280 × 720 as the initial minimum acceptance target. A 960 × 640 compact study explores fallback behavior; it is not a support promise. Confirm these targets on the first functional prototype. Mobile/touch is outside the current target decision. Gamepad navigation is planned and not currently certified.

Use available CSS viewport space, including short windows, rather than a fixed image-sized canvas. Keep headers, close/back and consequential actions reachable; scroll the content region. Support longer labels and enlarged text through wrapping and reflow. Proposed UI-scale choices are 100%, 125% and 150%, to be decided after the compact Inventory study. Browser text enlargement must not lose access to menu actions; full accessibility scope remains separately tracked.

For Inventory, start with Equipment / Bag / Details on a wide desktop. At narrower widths, keep Equipment and Bag usable and move Details below or into an explicit inspection view. Keep selection and comparison context stable while resizing. Stash uses the same grid semantics; side-by-side containers become an explicit Bag/Stash view on compact layouts, with a clear transfer destination. Never resize the underlying inventory or change item rules to fit a layout.

HUD anchors should protect the central combat space. Preserve recognizable health/mana orbs, six action slots, supplies and weapon-set identity. Larger windows gain breathing room rather than larger empty bars. Compact layouts recompose around the combat area instead of stacking into it. Extra quest trackers, minimaps or meters need a gameplay requirement before design.

## Shared component contracts

Build these as small DOM/CSS patterns in the existing `src/ui/` boundaries, driven by current gameplay definitions. Introduce a shared primitive only when there is a concrete consumer; use Inventory and Options to prove reuse. A framework, Storybook installation or new UI dependency is not a prerequisite.

| Family | Contract |
| --- | --- |
| Menu shell | Named heading, close/back, content region, stable actions; native dialog/top-layer behavior where appropriate |
| Button / icon button | Visible or accessible name; primary, secondary and consequential action roles; ordinary, hover, pressed, focus, disabled and pending states |
| Tabs / view switch | Selected state separate from focus; stable content relationship; real tab semantics only for a tab interaction model |
| Setting row | Label, value, control; live application or draft/Apply explicitly matches current owner; keyboard adjustments and visible errors |
| Item cell / equipment slot | Shared footprint and icon rules; selected, equipped, hovered, focused, carried, valid/invalid placement and pending states |
| Item detail / comparison | Stable identity, authored properties, signed numeric deltas and clear comparison target; action stays associated with selected item |
| Ability slot / skill choice | Assignment, lock reason, weapon compatibility, resource/cooldown state, binding label; readiness reflects gameplay |
| Tooltip / context prompt | Brief useful content on hover and focus; no critical action hidden exclusively in a tooltip; keep within viewport |
| Resource / progress | Name/value available without color; consistent number formatting; no distracting announcements every frame |
| Feedback / confirmation | Local explanation and recovery action; retain selection and player data on failure; reserve confirmations for real consequences |

Do not treat disabled, unavailable, locked and pending as one dimmed appearance. A pending mutation blocks duplicate submission, acknowledges the action and retains the correct selection; success and failure resolve from the real owner, never an animation timer. Avoid hiding needed context by fading the entire component.

## Interaction and accessibility

Preserve current [input ownership](RUNTIME.md#action-bar-and-input-ownership), [inventory commits](RUNTIME.md#inventory-commits) and [save recovery](RUNTIME.md#save-recovery). Menus pause gameplay and clear movement/held actions. UI events are consumed before world attacks. Native dialog dismissal requires a click beginning and ending outside; it must not attack through the menu. Options applies settings live; Keybindings owns a draft and Apply/Cancel. A visual redesign does not change these policies accidentally.

For new implementations, define initial focus, visible focus order, close/back behavior and return focus explicitly. Escape cancels the current transient interaction before leaving the owning screen where that behavior applies. Dragging retains a click/keyboard operation for the same player goal; provide clear destination/quantity and cancellation. Gamepad planning includes directional focus, confirm, back, scrolling and alternate operations, but does not add controller support until the input owner implements it.

Target WCAG 2.2 AA menu guidance: ordinary text contrast at least 4.5:1; large text and required non-text state/control identification at least 3:1. Use a stronger Lantern target for menu hit areas than the 24px WCAG minimum where layout permits. Selection, gains/losses, invalid placement and cooldown availability need shape/text/value cues as well as color. Keep overlays readable over bright and dark world imagery. Screen-reader menu names, values and meaningful status updates are part of component design; continuously changing combat values need an intentional announcement policy. These targets do not assert whole-game WCAG conformance.

Primary references: [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), and [minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Treat them as concrete design constraints, then inspect the actual implementation.

## Adoption order and ownership

1. Select an Inventory material treatment and confirm its information hierarchy; study the same layout at compact size.
2. Build a development-only DOM component specimen with fixed representative data, isolated from saves/gameplay, then one functional Inventory vertical slice. Show state variants beside the real components rather than approximating them in images.
3. Extract the proven semantic tokens and shared menu/control patterns beside `src/ui/`; migrate Inventory and stash with existing operations intact.
4. Apply those patterns to HUD/action bar and Skills, then Options/Keybindings. Refine at gameplay scale with one relevant interaction per task.
5. Finish travel, shelter, loot/context prompts, outcomes, startup/loading and save-error/recovery presentation. Extend to shops/Smithing and future screens when their gameplay owners are ready.

The [workflow](ui/WORKFLOW.md) defines the brief, mockup records and acceptance. New screen work updates its catalog row and relevant decisions. Shared tokens/components must have one code owner and documented consumers; avoid per-screen copies of foundation values. Keep developer authoring/labs identifiable and functional with shared readability primitives, while player screens receive the game treatment.

Definition of completion: the intended task works; the screen has a coherent hierarchy; relevant states and input paths are usable; the changed responsive case retains accessible actions; the weakest visible part has been inspected and refined; and the lean sanity gate passes. Report material limits directly. Whole-game polish remains an ongoing migration, not a claim attached to this foundation.
