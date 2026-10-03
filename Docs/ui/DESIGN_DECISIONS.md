# UI design decisions

Use [the design system](../UI_DESIGN.md) for shared rules and [the workflow](WORKFLOW.md) for evidence. Update a decision when an answer or inspected prototype resolves it. Keep adopted, proposed and deferred decisions distinct. Dates below use the project owner's local date.

## Agreed direction — October 2, 2026

| Decision | Status | Basis and implication |
| --- | --- | --- |
| Warm, crafted fantasy with restrained ornament | Adopted by owner | Explicit choice; extend Lantern's warm grimdark, iron/brass/smoky glass and amber refuge |
| Desktop keyboard/mouse first | Adopted by owner | Explicit choice; prioritize readable desktop interactions |
| Plan gamepad and smaller windows | Adopted by owner | Include focus/back/alternate-operation design and compact layout studies; implementation/support remains outstanding |
| A — Crafted instrument is the preferred material treatment | Adopted by owner | Explicit selection after reviewing A/B/C; fine brass and warmer detail; organization not approved |
| Stay in design much longer; do not build the prototype | Historical; explicitly lifted for Inventory/stash | Explore many layout directions, information hierarchy, responsive compositions and flow/state studies; implementation waits for an explicit owner request |
| Design from first principles; ask guiding questions with recommendations at every step | Explicit owner instruction | Prototype UI is rough/unintended; do not preserve its elements or flows as design requirements |
| Illustrated paper doll with surrounding equipment slots | Adopted by owner | A person silhouette, not a rendered character model |
| Consistent item artwork scale | Adopted by owner | Same scale in bag, equipment and carry; no enlarged inspection art or smaller equipped art |
| Hover tooltips; no persistent item selection/inspector | Adopted by owner | Hover/focus supplies useful details; carry/drag state exists only during interaction |
| Icon controls and direct item actions | Adopted by owner | Prefer recognizable icons; right-click consumables to use, direct gear action; define keyboard equivalents and ambiguous secondary choices |
| Remove unrelated/redundant Inventory content | Adopted by owner | No Woodcutting/Mining/Axe Combat footer or separate Scroll of Return section; no redundant “Helmet” line or random instructions |
| Loadout and quick gear exchange are Inventory's primary task | Adopted by owner | Equipment and carried items visible together; organization supports changing gear directly |
| Spatial bag with different item footprints | Adopted by owner | Physical organization; preserve each item's artwork scale across bag/equipment/carry; exact dimensions remain open |
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
| Material finish within selected A | Quiet reading surfaces, thin brass, selective iron joints; use B's calmer framing as a refinement reference | Refine [the selected Inventory concept](concepts/README.md) at actual use size; remove excessive glow/framing | Proposed refinement of adopted direction |
| Heading/reading typography | Pirata One for short headings, readable sans for controls and numbers | Inspect title, item name, long label and stat row at gameplay scale | Proposed |
| Icon finish | Original painterly item/ability art with shared silhouette/padding/light; DOM text and code-owned state chrome | Compare several representative icons at actual slot size; respect licensed-art provenance | Proposed |
| Split-panel detailed hierarchy | Refine chosen 40/60 panel at one item-art scale | Static art/slot/tooltip composition and responsive studies with guiding questions | Open within adopted family |
| Empty slot finish | Refine selected subtle outline glyphs, useful hover information | Study silhouette association, line weight and occupied/empty contrast | Open refinement |
| Weapon-set viewing/activation behavior | Show and activate together | Implemented through prepared equipment owner | Adopted / implemented |
| Stash organization | Stash left / Bag right, equipment hidden; both grids remain full size | Reviewed at 1280 × 800 | Adopted / implemented |
| Minimum window/UI scale | Adopted 1280 × 800 content viewport; one 48px item ruler | Minimum-size native-WebGPU browser interaction review | Implemented; device/controller certification remains future work |
| HUD hierarchy/organization | Start from urgent player information and protected play space; do not inherit orb/bar organization | Guiding questions, multiple resource/action layouts and feedback storyboards | Open design study |
| Accessibility scope | Menu contrast, visible focus, keyboard paths, larger targets, reduced motion and color-independent state as baseline | Validate changed component pairs and one representative input flow; record wider gaps | Proposed; conformance unverified |
| Navigation architecture | Start from player tasks and predictable icon/back behavior, not existing menu arrangement | Guiding questions and static entry/exit/navigation storyboards | Open design study |
| First implementation | Real Inventory/stash with shared art, tooltips and direct actions | Owned native-WebGPU preview and focused interaction review | Authorized / implemented |

Material identity is sufficiently established for layout studies. Ask guiding questions with recommendations at every consequential design step. Routine design work may proceed within the current phase; implementation waits for the owner's explicit request.

## Deferred scope

Touch/mobile, console certification, a new UI framework, general character levels, rarity tiers, quest trackers and minimaps are not implied by the design request. Shops, Smithing, proficiency unlocks and future front-end screens receive design coverage when the [roadmap](../../ROADMAP.md) and their gameplay owners establish requirements. Concurrent work can advance those owners; refresh the catalog before implementing them.

## Skills design checkpoint — October 2, 2026

Owner selected [28 named tracks](concepts/skills-nodes/BRIEF.md#roster), with progress and the next useful unlock as the main purpose, inspectable planned tracks and independent future weapon/magic practice. The first round used grouped list/detail and an internal assignment strip; the later node redesign below supersedes that interaction/layout checkpoint.

The owner requested original ImageGen mockups and variants. [First-round studies](concepts/skills/README.md) remain historical provenance; use the active redesign below for current direction. Generated numbers/artifacts are not balance or behavior decisions; concept tasks change no runtime, saves, XP sources or abilities.

## Skills node redesign — October 2, 2026

Owner selected an Inventory-sized Skills sheet, with larger ability nodes (Basics, Skills, Ultimates) and smaller passive-bonus nodes for every skill, a unique icon for each node, and hover information. The owner removed Assigned Abilities: drag available ability nodes to the actual bottom gameplay action bar, or click an empty slot to choose an available action. Passives are bonuses, not bar assignments. Keyboard focus/activation provides equivalent information and picker access.

The owner initially proposed upward roots; [that gallery](concepts/skills-nodes/README.md) is superseded by the selected horizontal design below. Representative passive content is illustrative; no new effects are adopted. The action bar stays outside the sheet; no duplicate in-panel strip.

## Skills horizontal design and implementation — October 2, 2026

Owner selected [the six-step left-to-right grouping](concepts/skills-horizontal/README.md) with two smaller passives between adjacent majors and authorized implementation. Category tabs are above; every skill in the active category fits simultaneously below. Combat/Magic show two Basics, two Skills and two Ultimates; Gathering/Crafting use generic Major/Minor placeholders. A level ruler marks 10/20/30/40/50 above the roots; no XP bar.

Owner chose existing actions plus planned nodes, requested proposed thresholds and generic profession labels. Six future targets are provisionally 1/10/20/30/40/50 with intermediate pairs 3/6, 13/16, 23/26, 33/36, 43/46. Existing actions remain immediately available; these prospective targets do not gate them or activate undefined effects. Revision 8 records all 28 XP tracks without changing current XP sources. [The brief](concepts/skills-horizontal/BRIEF.md) records owners and acceptance.

## Decision entry format

For a consequential change, append a short dated entry with: question; adopted choice; owner/evidence; affected tokens/components/screens; remaining uncertainty. Link the exact prompt/concept or prototype evidence. Rewrite the active recommendation when it changes, rather than leaving conflicting prescriptions. Keep routine visual tuning beside the owning component instead of producing a decision entry for every pixel.
