import type { Skill } from '../gameplay/skills';
import type { SkillNode } from '../gameplay/skill-nodes';
import type { LootItem } from '../gameplay/inventory';
import { itemIcon } from './item-icons';
import { abilityIcon } from './ability-icons';

const items: Partial<Record<Skill, LootItem>> = {
  sword:'sword',axeCombat:'axe',bow:'bow',staff:'staff',shield:'shield',defense:'guard-helm',
  woodcutting:'axe',mining:'iron',leatherworking:'duelist-gloves',
};
const shapes: Partial<Record<Skill, string>> = {
  mace:'M24 41V19 M17 8h14v12H17z M21 4h6v4 M13 11h4 M31 11h4',
  dagger:'m24 5 5 8-3 17h-4l-3-17z M16 31h16 M24 31v10',
  spear:'m24 3 6 10-6 8-6-8z M24 21v23',
  greatsword:'m24 3 8 11-5 19h-6l-5-19z M13 33h22 M24 33v11',
  greathammer:'M24 43V19 M9 7h30v14H9z M15 7v14 M33 7v14',
  crossbow:'M9 12q15-12 30 0 M9 12l15 12 15-12 M24 6v36 M18 34h12',
  wand:'M14 40 28 17 M28 4v6 M35 8l-4 4 M39 17h-6 M20 8l4 4 M23 17h-6',
  evasion:'M17 7a4 4 0 1 0 8 0 M18 16l-7 9 M18 16l9 6 8-5 M22 20l-6 11-9 9 M22 27l9 6 5 8 M4 18h8 M4 25h5',
  burn:'M25 4c3 12 12 13 12 24a13 13 0 0 1-26 0c0-7 5-13 9-17l-1 14c8-5 10-12 6-21z',
  freeze:'M24 4v40 M7 14l34 20 M7 34l34-20 M19 9l5 5 5-5 M19 39l5-5 5 5 M7 20l7-2-1-7 M35 37l-1-7 7-2',
  nature:'M12 40c2-17 7-23 24-31 4 19-6 28-20 24 M15 34l15-17 M21 26l-1-8 M21 26h10',
  healing:'M19 5h10v14h14v10H29v14H19V29H5V19h14z',
  herbalism:'M24 43V21 M24 28C7 27 6 14 8 8c15 2 17 9 16 20 M24 33c15-1 18-10 17-17-13 0-17 6-17 17',
  smithing:'M7 27h34l-8 7H19l-4 8 M6 18h20v9H6z M27 8l9-5 7 11-10 5z M32 17l-8 12',
  tailoring:'M13 12h22v29H13z M17 7h14v5 M19 12v29 M29 12v29 M5 7l37 35',
  woodworking:'M8 28h31v13H8z M13 19h21v9H13z M17 9h13v10H17z M8 34h31',
  alchemy:'M18 4h12 M21 4v14L9 36q-2 7 5 7h20q7 0 5-7L27 18V4 M14 31h20 M19 36h2 M27 37h2',
  cooking:'M8 20h32v14q0 8-16 8T8 34z M4 23h4 M40 23h4 M18 4q-4 4 0 8 M29 4q-4 4 0 8',
  jewelcrafting:'m24 5 17 14-17 24L7 19z M7 19h34 M17 11l7 8 7-8 M24 19v24',
};
export function skillIcon(id: Skill): string {
  const item = items[id];
  if (item) return itemIcon(item);
  return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="' + (shapes[id] ?? '') + '"/></svg>';
}
const minorShapes = [
  'm17 6 6 8-3 18h-4l-3-18z M9 32h20 M18 32v10 M30 20l7-7 7 7 M37 13v16',
  'M13 5h22 M13 43h22 M16 5c0 13 16 13 16 19s-16 6-16 19 M32 5c0 13-16 13-16 19s16 6 16 19',
  'M10 7h16v34H10z M10 14h7 M10 22h10 M10 30h7 M33 10v28',
  'M24 4C20 14 11 20 11 29a13 13 0 0 0 26 0C37 20 28 14 24 4z M19 29q0 6 6 6',
  'm15 6-10 8-2 13 11 4v12h20V31l11-4-2-13-10-8-9 7z M17 23h14 M24 16v18',
  'm24 4 15 16-15 24L9 20z M9 20h30 M24 4l-6 16 6 24 6-24z',
  'M13 6h18l-2 21 12 8v8H8v-9l7-10z M13 14h17 M13 21h16 M9 38h31',
  'm24 4 16 7v16c-2 10-9 14-16 18-7-4-14-8-16-18V11z M24 11v26 M15 24l6 6 12-15',
  'M11 39C7 17 20 7 38 6c-1 18-11 31-27 33z M11 39l19-22 M20 28l-1-10 M20 28h11',
  'M11 42 7 26l3-16h5l2 13 3-19h5l-1 20 7-15h5l-6 26-9 7z M10 32h17',
];
const masteryShapes = [
  minorShapes[0],minorShapes[1],minorShapes[2],minorShapes[3],
  'M24 5v29 M18 26l6 8 6-8 M7 41l10-5 M41 41l-10-5',
  'M10 39 29 7 M20 40 39 8 M25 8h5v8 M34 9h5v8 M6 33l9 6 M16 34l9 6',
  'M10 7h22 M13 7c0 12 15 12 15 19S13 33 13 42 M28 7c0 12-15 12-15 19s15 7 15 16 M10 42h22 M35 17l7 7-7 7',
  'M8 7h16v34H8z M8 14h7 M8 22h10 M8 30h7 M30 11h11 M30 36h11 M35 11v25 M32 16h6 M32 30h6',
  'M17 5C12 17 6 23 6 31a11 11 0 0 0 22 0c0-8-6-14-11-26 M33 15c-4 10-7 14-7 20a8 8 0 0 0 16 0c0-6-5-12-9-20',
  'M7 11 38 37 M7 24l28 17 M13 5l29 24',
];
export function skillNodeIcon(skill: Skill, node: SkillNode): string {
  if (node.ability) return abilityIcon(node.ability);
  if (node.kind === 'minor') {
    return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="' + (node.implemented ? skill==='bow' && node.index===4 ? 'M12 5v25 M8 24l4 6 4-6 M25 10v25 M21 29l4 6 4-6 M38 5v25 M34 24l4 6 4-6 M7 42h34' : skill==='bow' && node.index===9 ? 'M24 4v8 M24 36v8 M4 24h8 M36 24h8 M24 15a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M18 30 31 17' : masteryShapes[node.index] : minorShapes[node.index]) +
      '"/><svg x="32" y="33" width="14" height="14" viewBox="0 0 48 48">' + skillIcon(skill) + '</svg></svg>';
  }
  const motifs = [
    '', '<path d="M8 40 40 8 M8 8l32 32"/>',
    '<path class="skill-accent" d="M5 27a20 20 0 0 1 36-12 M35 8l6 7-8 2"/>',
    '<path class="skill-accent" d="M5 36 40 12 M30 11h11v11 M5 30h9 M10 41v-9"/>',
    '<path class="skill-accent" d="M24 2v7 M24 39v7 M2 24h7 M39 24h7 M8 8l5 5 M35 35l5 5 M8 40l5-5 M35 13l5-5"/>',
    '<path class="skill-accent" d="M6 19c3-17 32-20 37 0 M42 29c-3 17-32 20-37 0 M5 29l-2 7 8-1 M43 19l2-7-8 1"/>',
  ];
  return '<svg viewBox="0 0 48 48" aria-hidden="true"><svg x="8" y="8" width="32" height="32" viewBox="0 0 48 48">' +
    skillIcon(skill) + '</svg>' + motifs[node.index] + '</svg>';
}
