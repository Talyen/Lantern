# Gathering — techniques and smaller bonuses — exact ImageGen prompt

- Date: October 2, 2026 (America/Los_Angeles).
- Tool: built-in image_gen.imagegen.
- Purpose: original Skills layout/state concept, not runtime artwork.
- Output: 04-gathering-major-minor.png
- SHA-256: d2596e3468ec4a9d0ad473577462e13d427fef8f1333024021eb688688e7fedf
- Input: reference-input.png
- Input SHA-256: ae407c9abfab28ea34fc1477d8b594733fad5d82948f5aa3b497cbea442c9e5c
- Input role: original generated UI reference/edit target. User selected original round-two A as the starting reference.
- Licensed art: no game models, textures or gameplay renders submitted.

## Prompt

```text
Use case: ui-mockup. Edit/reference input is an ORIGINAL previously generated Lantern Skills UI concept supplied by the user. Retain its quiet dark crafted-fantasy palette and large-screen proportions while making the requested structural redesign. No licensed art. Landscape 16:10 straight-on desktop UI, nominal1280x800, single complete screen.
Near-full-width sheet x16..1264, y32..680; external actual gameplay action bar bottom-center below it. Title "Skills", upper-right X, four top category tabs Combat / Magic / Gathering / Crafting. Warm opaque soot charcoal, restrained brass iron seams, ivory type, short Gothic headings and clean readable body. No neon, busy ornament, white margins, invented lore or status paragraphs.
Header selected skill name and "Level 3" only. REMOVE every XP number, XP text, XP BAR, progress-percent or resource bar from this menu.
Middle contains selected talent tree progressing LEFT TO RIGHT, not upward; larger square major nodes and smaller circular passive nodes, each with unique pictorial icon. All nodes including future ones retain distinct icon art, with tiny supplemental lock badge as needed, never generic padlock replacement. Hover/focus produces compact useful tooltip, no permanent inspector. Connections indicate visual progression only, not point-spending currency, class restriction or invented prerequisites.
Immediately ABOVE the bottom skill-navigation row, add a thin LEVEL TRACK running LEFT TO RIGHT with five clear milestone ticks labeled exactly "10", "20", "30", "40", "50". A small current-level marker near the left corresponds to Level3; no filled XP progress bar, no fractional XP value. Track is tied to selected skill, not character level;50 is shown milestone not declared maximumlevel.
Bottom INSIDE panel: every skill in the ACTIVE CATEGORY is visible simultaneously, evenly spaced original skill icons with compact readable exact names. NO horizontal scrollbar, arrows, clipped skills or navigation carousel. Category tabs make other categories available, not all28skills simultaneously. Exact roster: Combat14 = Sword, Axe, Mace, Dagger, Spear, Greatsword, Greathammer, Bow, Crossbow, Staff, Wand, Shield, Defense, Evasion. Magic4 = Burn, Freeze, Nature, Healing. Gathering3 = Woodcutting, Mining, Herbalism. Crafting7 = Smithing, Leatherworking, Tailoring, Woodworking, Alchemy, Cooking, Jewelcrafting. NEVER add Fishing/Foraging/Carpentry etc.
Exactly ONE six-slot gameplay bar BELOW OUTSIDE Skills Q E R G LMB RMB with current icons Sweep / Piercing Shot / empty / empty / Sword Basic / Shield Basic. NO "Assigned Abilities", "Ability Assignments", "Loadout", duplicated in-panel bar or instruction footer. Users drag actions to actual bar; empty slot opens ability picker.
These are original composition mockups, with illustrative future nodes and Level3, not adopted unlock thresholds or XP gameplay.
Gathering tab selected. Header "Woodcutting" "Level 3". Bottom contains ALL THREE skillicons+names simultaneously: Woodcutting, Mining, Herbalism, selectedWoodcutting; NO scrollarrows. Selectedtree progressesLEFTTORIGHTacrosscanvas with SIXdistinct larger square MAJOR nodes labeled "Technique I", "Technique II", "Technique III", "Technique IV", "Technique V", "Technique VI". Each own original action/tool pictogram: axe/stump, axe/loggrain, saw/log, splitwood/wedge, sharpenedaxe, timber bundle/tool. These are unimplemented representative technique placeholders, not recipes or newmaterials.
EXACTLY TEN smaller unique circular MINORnodes staggered above/below the horizontalmajorpath: woodbundle, hourglass, sprout, woodrings, leaf, glovedhand, pairedtools, knotwood, brassmeasuringrule, a smallstackoflogs. No repeatedpadlock-onlyart. First fewnodes quietlearnedstates, latermutedwithtinylockbadge. Hovertip beside majorTechniqueII says "Woodcutting Technique", "Major unlock", "Not yet defined". No numeric bonuses invented.
Absolutely NO Basic / Skill / Ultimate category labels anywhere in profession tree. Major nodes represent techniques/resourcecapabilities; minor nodes represent yield/efficiency/proficiencybonus possibilities. No combat attackeffects, classlevel, recipes or Craftbutton. ONE leveltrack10 20 30 40 50 immediatelyabovebottom3skillrow, currentmarkerLevel3, NO XPbars. Externalcombatbarremainsunchangedbelowoutsidepane evenwhenbrowsingprofession. Use fullwidthspaceconfidently.
```
