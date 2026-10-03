# Crafting — recipe-group milestones and smaller bonuses — exact ImageGen prompt

- Date: October 2, 2026 (America/Los_Angeles).
- Tool: built-in image_gen.imagegen.
- Purpose: original Skills layout/state concept, not runtime artwork.
- Output: 05-crafting-major-minor.png
- SHA-256: 3b77670218dafc7b7f3ab37c7271d49bb95c13e7b7e2144b9ceac131ca3a25f7
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
Crafting tabselected. Header "Smithing" "Level 3". Bottom ALLSEVENskills fitvisibleatonce with exacticons/names inthisorder: Smithing, Leatherworking, Tailoring, Woodworking, Alchemy, Cooking, Jewelcrafting; Smithingselected. NOarrows/scrollbar. Craftingtree LEFTTORIGHT with SIXlarger UNIQUE major squarepictograms labeled "Recipe Group I","Recipe Group II","Recipe Group III","Recipe Group IV","Recipe Group V","Recipe Group VI". Uniqueart: hammer/anvil, tongs/ingot, armoredglove, forgedsword, breastplate, furnace/bellows. These are visualplaceholdersforfuturecapabilitygroups, NOTimplementedrecipes or committedrecipecontent.
EXACTLY TENsmalleruniqueminorcircles above/between/belowmajorpositions: ingot, hourglass, pliers, whetstone, charcoal, leathergrip, measuringrule, bellows, glove, sparks. Allfutureart remainsvisiblewithsmalllockbadges; no genericdots. Hovertip onminorwhetstone shows "Smithing Bonus", "Minor unlock", "Not yet defined". No numericalbonusorrecipepriceinvented.
AbsolutelyNO Basic / Skill / Ultimate headingsorattacks inCraftingtree. No randomitemproperties,raritytiers,spendpoints,Craftbutton,materialcostsorconstructeditempreview. ONE leveltrack10 20 30 40 50 immediatelyabovebottom7skillicons, currentLevel3marker,NO XPbar. Oneexistingexternal6slotgameplayactionbarbelowpane unchanged.
```
