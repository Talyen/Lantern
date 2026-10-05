# Skills screen brief

Player goal: inspect progress and the next useful unlock, then assign an earned action. The sheet pauses gameplay and uses the shared Inventory-sized shell, category tabs, horizontal major/minor progression and skill-selection row. All 28 stable tracks have saved XP; runtime owners distinguish implemented tracks from planned ones.

Sword/Bow major nodes follow learning order and their ten chronological passives describe actual automatic benefits. Axe shows its live authored actions. Gathering/Crafting use their actual schedules and generic Major/Minor labels for undefined nodes. [Progression](../../../PROGRESSION.md) owns levels and rewards; [Equipment](../../../EQUIPMENT.md#sword-and-bow-mastery) owns combat unlocks. Undefined nodes stay planned even when XP reaches a displayed threshold.

Available actions drag to the actual bottom gameplay action bar; an empty slot opens its picker. Assignment changes only that slot. Passives remain automatic, and keyboard focus/activation provides equivalent information and picker access. The sheet does not duplicate the action bar or add an Assigned Abilities region. Each node has its own icon and hover/focus information.

Use the [adopted reference](README.md) for composition and exact original provenance. Actual schedules, labels, bindings, availability and behavior come from [SkillsPanel](../../../../src/ui/skills-panel.ts), [CombatUI](../../../../src/ui/combat.ts), [skills](../../../../src/gameplay/skills.ts) and [node definitions](../../../../src/gameplay/skill-nodes.ts). Wider controller, accessibility and mastery-pacing acceptance remain open.

## Layout and interaction constraints

- All active-category skills fit together at 1280 × 800, including fourteen Combat entries; no carousel, horizontal navigation scrolling or XP bar.
- The six major and ten minor positions use the current schedules; the ruler ends at 20 while the heading shows the actual derived level beyond it. Level 20 is not a cap.
- The one real action bar remains physically outside the sheet in the dialog's modal layer. Empty-slot picker mode hides the sheet and prevents gameplay input through the popup.
- Escape cancels carrying or the picker before closing the sheet; focus returns to its slot or gameplay. Category/skill navigation does not change assignments.
- Categories remember their last browsed skill for the session. Initial selection follows the equipped weapon family, with Sword as the fallback.
