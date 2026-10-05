# UI design decisions

Use [the design system](../UI_DESIGN.md) for shared rules and [the workflow](WORKFLOW.md) for evidence. Update a decision when an answer or inspected prototype resolves it. Keep adopted, proposed and deferred decisions distinct. Maintain current choices and unresolved questions rather than dated checkpoints.

## Agreed direction

| Decision | Status | Basis and implication |
| --- | --- | --- |
| Warm, crafted fantasy with restrained ornament | Adopted by owner | Explicit choice; extend Lantern's warm grimdark, iron/brass/smoky glass and amber refuge |
| Desktop keyboard/mouse first | Adopted by owner | Explicit choice; prioritize readable desktop interactions |
| Plan gamepad and smaller windows | Adopted by owner | Include focus/back/alternate-operation design and compact layout studies; implementation/support remains outstanding |
| A — Crafted instrument is the preferred material treatment | Adopted by owner | Explicit selection after reviewing A/B/C; fine brass and warmer detail; organization not approved |
| Design from first principles; ask guiding questions with recommendations at every step | Explicit owner instruction | Prototype UI is rough/unintended; do not preserve its elements or flows as design requirements |
| Illustrated paper doll with surrounding equipment slots | Adopted by owner | A person silhouette, not a rendered character model |
| Consistent item artwork scale | Adopted by owner | Same scale in bag, equipment and carry; no enlarged inspection art or smaller equipped art |
| Hover tooltips; no persistent item selection/inspector | Adopted by owner | Hover/focus supplies useful details; carry/drag state exists only during interaction |
| Icon controls and direct item actions | Adopted by owner | Prefer recognizable icons; right-click consumables to use, direct gear action; define keyboard equivalents and ambiguous secondary choices |
| Remove unrelated/redundant Inventory content | Adopted by owner | No Woodcutting/Mining/Axe Combat footer or separate Scroll of Return section; no redundant “Helmet” line or random instructions |
| Loadout and quick gear exchange are Inventory's primary task | Adopted by owner | Equipment and carried items visible together; organization supports changing gear directly |
| Spatial bag with different item footprints | Adopted / implemented | Physical organization; preserve each item's artwork scale across bag/equipment/carry; implementation retains the 12 × 8 bag/stash model with one 48px ruler |
| Tooltip name and useful properties only | Adopted by owner | Explicit choice over proposed comparison; no automatic comparison, redundant category or instruction copy |
| One large split panel: equipment left, inventory right | Preferred family selected by owner | Explicit response after organizational studies; silhouette and surrounding slots left, continuous spatial bag right; exact design still open |
| 40% equipment / 60% inventory | Adopted by owner | Explicit proportion choice; equal item-art scale across halves; reflow questions remain open |
| Subtle outline glyphs in empty equipment slots | Adopted by owner | Explicit choice; keep silhouette and equipped art primary; details on useful hover/focus |
| Tight slot cluster around an artistic Vitruvian-inspired paper-doll sketch | Adopted by owner | Replace filled silhouette with original sketch; tighten spacing without shrinking item art |
| Unified toolbar | Adopted by owner | I/II weapon-set icons upper left, Sort in toolbar and Close at far right |
| Direct right-click equip/unequip/use plus drag | Adopted by owner | Explicit interaction choice; no permanent action row |
| Ring auto-destination without new UI | Adopted by owner | Fill empty ring slot first, otherwise replace left; manually drag to right. Left-first when both empty is the documented deterministic interpretation |
| Replaced gear returns to bag automatically | Adopted by owner | Use vacated space when it fits, otherwise another free space; block safely with brief local feedback if no room |
| Set toolbar icons show actual main-hand weapon plus tiny I/II badge | Adopted by owner | Explicit choice; glyph communicates current loadout and badge stable set identity |
| Equipment receptacles are compact and grid-aligned | Adopted by owner | Shared columns/row anchors, still associated with body regions; no scattered orbit or artwork shrinking |
| Paper doll is a faint rough background sketch | Adopted by owner | Vitruvian-inspired pose with minimal detail; items/slots are the focal point, not the figure |
| Implement the refined Inventory and stash | Explicit owner authorization | Continue guiding questions; later screens remain separate design work |
| Set icons show and activate the chosen set | Adopted by owner | Highlighted set is the active prepared loadout; no resource refill or cooldown reset |
| Stash left / Bag right, without equipment | Adopted by owner | Supersedes three-region and tab proposals; independent Sort controls |
| Right-click transfers while stash is open | Adopted by owner | Drag specifies placement; normal Inventory retains use/equip/unequip |
| Minimum supported viewport 1280 × 800 | Adopted by owner | [Steam Deck display specification](https://www.steamdeck.com/en/tech); 16:10 floor, common 16:9/16:10 desktop range; supersedes 1600 × 900 |
| All screens/components should converge on a shared system | Requested by owner | One reusable vocabulary and screen migration process; no numerical quality certification |
| Original ImageGen mockups for screen/layout direction | Requested by owner | Save prompts, images, critique and decision status; verify interactions in DOM prototypes |

The native-only WebGPU pipeline and private-art boundaries remain owned by their existing guides. Current game models/catalogs inform available content. UI behavior and organization are designed afresh; proposed changes to underlying game rules are explicit discussion points.

## Decisions to resolve next

| Decision | Recommendation | How to decide | Status |
| --- | --- | --- | --- |
| Material finish within selected A | Quiet reading surfaces, thin brass, selective iron joints; keep the adopted quiet framing | Refine [the selected Inventory concept](concepts/inventory/README.md) at actual use size; remove excessive glow/framing | Proposed refinement of adopted direction |
| Heading/reading typography | Pirata One for short headings, readable sans for controls and numbers | Inspect title, item name, long label and stat row at gameplay scale | Proposed |
| Icon finish | Original painterly item/ability art with shared silhouette/padding/light; DOM text and code-owned state chrome | Compare several representative icons at actual slot size; respect licensed-art provenance | Proposed |
| Split-panel detailed hierarchy | Refine chosen 40/60 panel at one item-art scale | Static art/slot/tooltip composition and responsive studies with guiding questions | Open within adopted family |
| Empty slot finish | Refine selected subtle outline glyphs, useful hover information | Study silhouette association, line weight and occupied/empty contrast | Open refinement |
| Weapon-set viewing/activation behavior | Show and activate together | Implemented through prepared equipment owner | Adopted / implemented |
| Stash organization | Stash left / Bag right, equipment hidden; both grids remain full size | Reviewed at 1280 × 800 | Adopted / implemented |
| Minimum window/UI scale | Adopted 1280 × 800 content viewport; one 48px item ruler | Minimum-size native-WebGPU browser interaction review | Implemented; device/controller certification remains future work |
| HUD hierarchy/organization | Adopted orb-led resources around the six-slot bar; utility slots outside, no visible set control, saved Resource Numbers | [HUD study and interaction record](concepts/hud-polish/README.md) | Adopted / implemented; wider accessibility and unfamiliar-player observation remain open |
| Accessibility scope | Menu contrast, visible focus, keyboard paths, larger targets, reduced motion and color-independent state as baseline | Validate changed component pairs and one representative input flow; record wider gaps | Proposed; conformance unverified |
| Navigation architecture | Start from player tasks and predictable icon/back behavior, not existing menu arrangement | Guiding questions and static entry/exit/navigation storyboards | Open design study |
| First implementation | Real Inventory/stash with shared art, tooltips and direct actions | Owned native-WebGPU preview and focused interaction review | Authorized / implemented |

Material identity is sufficiently established for layout studies. Ask guiding questions with recommendations at every consequential design step. Routine design work may proceed within the current phase; implementation waits for the owner's explicit request.

## Deferred scope

Touch/mobile, console certification, a new UI framework, general character levels, rarity tiers, quest trackers and minimaps are not implied by the design request. Shop and Sword/Bow proficiency already have gameplay/UI owners; refresh their current coverage before refinement. Smithing and future front-end screens receive design coverage when the [roadmap](../../ROADMAP.md) and their gameplay owners establish requirements. Concurrent work can advance those owners; refresh the catalog before implementing them.

## Skills direction

The [current Skills brief](concepts/skills-horizontal/BRIEF.md) owns category navigation, named tracks, horizontal major/minor progression and assignment. Available actions drag to the one actual action bar; empty slots provide the picker. Passives remain automatic. Current unlock schedules and rewards belong to [Progression](../PROGRESSION.md) and runtime owners.

## Loading and Smithing

The [loading brief](concepts/loading/README.md) owns the stationary lantern, delayed travel composition, actual readiness and accessible recovery. The [Workshop sheet](concepts/smithing/README.md) owns learned-only Forge/Reclaim organization; [Smithing](../SMITHING.md) owns raw-material costs, cancellation, Bag-only output and immediate permanent reclamation.
