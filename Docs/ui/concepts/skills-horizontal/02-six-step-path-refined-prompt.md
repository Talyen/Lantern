# Selected direction — six-step horizontal path — exact ImageGen prompt

- Date: October 2, 2026 (America/Los_Angeles).
- Tool: built-in image_gen.imagegen.
- Purpose: original Skills layout/state concept, not runtime artwork.
- Output: 02-six-step-path-refined.png
- SHA-256: 6843f55d3b0fe326f971d6558360c9a8801ad270f727a601ccf1b61f2d99d343
- Input: 02-six-step-path.png
- Input SHA-256: 31b2e0c88158fdc0ad639b577611378f986ab06cf039b13810a02a3ba043ef18
- Input role: original generated UI reference/edit target. User selected original round-two A as the starting reference.
- Licensed art: no game models, textures or gameplay renders submitted.

## Prompt

```text
Use case: ui-mockup. Edit ORIGINAL generated Lantern Skills UI, preserve near-full-screen charcoal/brass/ivory menu,4top tabs, selectedSwordLevel3, horizontalSIXbiguniqueactions BasicI BasicII SkillI SkillII UltimateI UltimateII, TENsmallunique passiveicons, milestoneleveltrack10 20 30 40 50 justaboveskillrow, NO XPbar, external6slotactionbarbelow. No new mechanics.
Correct the BOTTOM SKILL ROW ONLY: delete the erroneous duplicate Staff entry /extra icon and rebuild as EXACTLY14 equal cells, each with original skillicon+label, ALL fit on screen atonce, ordered EXACTLY:
1 Sword, 2 Axe, 3 Mace, 4 Dagger, 5 Spear, 6 Greatsword, 7 Greathammer, 8 Bow, 9 Crossbow, 10 Staff, 11 Wand, 12 Shield, 13 Defense, 14 Evasion.
Shield uses roundshieldart, Defense uses helmet/breastplateart, Evasion uses dodgingfigure. No duplicate label, noextra unlabeledicon, no arrows/scrollbar, no clippedlastcell. Widths fitinsideframemargins; currentSword selected. LongnamesremainexactGreatsword/Greathammer, never hyphenate. Keep actionbarOUTSIDEbelow unchanged.
Also remove invented ATTRIBUTE wording frompassive labels (Dexterity,Strength) by keeping smallpassives ICONONLY withhoverinfo, exceptthe existing Sword Damage tooltip. AllTEN passiveicons retainuniqueart. Do not add skillpoints. Keep exactlySIXlargeactionsandTENsmallpassives unchanged in count and order.
```
