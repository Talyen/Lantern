# Smithing workshop sheet

The owner selected A — Workshop sheet after three original layout studies, then settled its pending, blocked and reclaim behavior. The [Smithing rules](../../../SMITHING.md) own actual recipes, progression and transactions.

## Adopted direction

Use a compact left choice list and right detail/action region with Forge/Reclaim tabs. Show level and XP only in the header. Forge shows learned recipes only; future recipes are revealed on unlock. Skills remains the major/minor talent tree. Item properties, material contributions and rewards are truthful, concise and independent of sound.

Forging takes two seconds and can be cancelled without cost. Equipment output goes to Bag only. Reclaim acts immediately without confirmation or Undo, excludes equipped gear, awards a little XP and clears selection after completion.

| Study | Image | Exact prompt |
| --- | --- | --- |
| Selected organization | [Workshop sheet](workshop-sheet.png) | [Prompt](workshop-sheet-prompt.md) |

[Provenance](provenance.json) records the built-in ImageGen tool, original text-only inputs and SHA-256 hashes. Removed state studies remain in Git history; pending, blocked and reclaim behavior is documented in the Smithing rules. No licensed model, texture or gameplay capture was sent to ImageGen. Concepts are documentation, not imported runtime surfaces.

## Critique and implementation

A had the clearest hierarchy and supports a longer recipe list. The horizontal workbench would need another navigation treatment as recipes grow; the expanding ledger uses more vertical space. Those rejected variants remain in the conversation's generated-image directory.

Generated illustrations, oversized art, serif reading text and decorative framing are conceptual inaccuracies. The implementation uses the existing 48px item ruler, quieter framing, readable system controls, Pirata One headings and native DOM text. Exact hit areas, disabled states, keyboard focus and transaction outcomes are implementation responsibilities. Original stills do not establish gameplay quality.

The selected sheet was inspected at 1280 × 800 in an owned normal-settings preview. Missing materials were clear; a cancelled craft retained items/Stash/XP; Mail consumed Bag then Stash Iron and revealed Broadsword; reclaiming stored metal gear returned Iron to Stash and cleared the action. Additional private evidence remains with smithing-starter. Performance and whole-adventure pacing were not measured.
