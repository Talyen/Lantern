# Orb-led HUD polish

The owner selected the [orb-led study](orbs.png) on October 2, 2026, then removed the visible Set I control and requested a saved Resource Numbers toggle. Rejected alternatives are recoverable from Git history.

The owner requested the detailed visual finish of the concept, not only its organization. Production frames and dimensional icons are original ImageGen assets under `assets/ui/hud/`, referenced by the DOM atlas adapter. Values, actual bindings, cooldowns, captions, availability and focus remain live code. Inventory art and layout stay independent.

The mockup used illustrative Sword content and numeric bindings; the runtime retains real loadout, six assignments, utility counts and configured bindings. The concept's Set I and arrows do not ship. Resource Numbers defaults to On and hides only visible values. Weapon swapping remains bound and available in Inventory.

Prompts, inputs and SHA-256 hashes live in [concept provenance](provenance.json) and [production provenance](../../../../assets/ui/hud/provenance.json). No licensed input was used.

## Focused review

The owned 1280 × 800 native-WebGPU preview shows the detailed original chrome and painted icons over Clearing and Homestead at normal shipping reconstruction settings. Refinements addressed frame/background depth, grouped orbs, stacked live values, captions, binding plaques and distinct unavailable markers. Resource Numbers Off hides the visual text while retaining `aria-valuetext`. The visible Set I element is absent.

Focused deterministic checks protect impact clocks/pending input, retained piercing provenance and duplicate-contact suppression. Performance measurements, physical Steam Deck/controller use and unfamiliar-player observations are outside this local evidence.

Final interaction review: a real Sweep contact changed guard HP from 200 to 140 with mana consumption; shelter repair consumed the exact recipe once and exposed the restored stash; Skills opened, assigned Sword Basic to an empty slot and returned the action bar to play on Escape. The review repaired a pre-existing detached Skills dialog and widened the detailed HUD to separate adjacent captions. Resource Numbers Off now hides text and uses name-only hover titles while retaining meter values. The Crypt hall remained readable under the shared Golden lighting. All four affected private lighting exports were refreshed and checked against distinct area/signature pairs.

Post-integration review preserved the independently added grouped grass and floating combat feedback. Impact events retain damage/position and accepted-action provenance; feedback age uses the held gameplay clock. A real Axe contact changed guard HP from 200 to 150 and emitted matching `50` feedback in the ready native scene with no browser errors. Homestead/Clearing bakes were refreshed for new grass coverage; the Ruins export remained valid and Crypt has no changed grass. The lighting exporter now waits for the existing bounded readiness check before accessing a reloaded authoring bridge.
