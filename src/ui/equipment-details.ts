import type { CharacterSave } from '../gameplay/character-save';
import type { WeaponSet } from '../gameplay/abilities';
import { resolveCombatStats, type CombatStats } from '../gameplay/combat-stats';
import { equipmentCatalog, supportsShield, type EquipmentSlot, type ItemId, type WeaponItem } from '../gameplay/equipment';
import { lootDefinitions, type InventoryItem } from '../gameplay/inventory';

export function statLabel(key: keyof CombatStats): string {
    return {damage:'Damage',attackRate:'Attack speed',reach:'Reach / Range',armor:'Armor',maxHealth:'Health',maxMana:'Mana',manaRegen:'Mana recovery',moveSpeed:'Movement',family:'Weapon'}[key];
  }
export function statValue(key: keyof CombatStats, value: number): string {
    if(key==='attackRate')return `${Math.round(value*100)}%`;
    if(key==='reach')return `${Number(value.toFixed(2))} m`;
    if(key==='moveSpeed')return `${Number(value.toFixed(2))} m/s`;
    if(key==='manaRegen')return `${Number(value.toFixed(2))}/s`;
    return String(Number(value.toFixed(2)));
  }

/** Inventory and trading use the same authored properties and effective-loadout comparison. */
export function renderEquipmentDetails(details: HTMLElement, comparison: HTMLElement, entry: InventoryItem,
  character: CharacterSave, set: WeaponSet, slot: EquipmentSlot): void {
  const definition = equipmentCatalog[entry.item as ItemId];
    const line=(label:string,value:string)=>{const row=document.createElement('div'),name=document.createElement('span'),amount=document.createElement('strong');name.textContent=label;amount.textContent=value;row.append(name,amount);return row;};
    if(definition.weapon)for(const [key,value] of [['damage',definition.weapon.damage],['attackRate',definition.weapon.rate],['reach',definition.weapon.reach]] as const)details.append(line(statLabel(key),statValue(key,value)));
    const labels={armor:'Armor',health:'Health',mana:'Mana',manaRegen:'Mana recovery',damage:'Damage',attackRate:'Attack speed',moveSpeed:'Movement'};
    for(const [key,value] of Object.entries(definition.bonuses))details.append(line(labels[key as keyof typeof labels],`+${['damage','attackRate','moveSpeed'].includes(key) ? `${Math.round(value*100)}%` : `${value}${key==='manaRegen' ? '/s' : ''}`}`));
    if(entry.item==='shield')details.append(line('Frontal block','50% damage reduction'));
    const hand=slot==='main' || slot==='off';
    const equipped=character.items.find(item=>item.slot===slot && (!hand || (item.weaponSet ?? 0)===set));
    if(equipped?.id===entry.id)return;
    const label=document.createElement('p');label.textContent=equipped ? `Compared with ${lootDefinitions[equipped.item].name}` : 'Compared with empty slot';comparison.append(label);
    const candidate=character.items.filter(item=>item.id!==entry.id && !(item.slot===slot && (!hand || (item.weaponSet ?? 0)===set)) && !(slot==='main' && !supportsShield(entry.item as WeaponItem) && item.slot==='off' && (item.weaponSet ?? 0)===set));
    candidate.push({...entry,slot,weaponSet:hand ? set : undefined});
    const before=resolveCombatStats(character.items,set),after=resolveCombatStats(candidate,set);
    for(const key of ['damage','attackRate','reach','armor','maxHealth','maxMana','manaRegen','moveSpeed'] as const) {
      const delta=after[key]-before[key];if(Math.abs(delta)<.00001)continue;
      const amount=key==='attackRate' ? `${Math.round(delta*100)}%` : statValue(key,delta);
      const row=line(statLabel(key),`${delta>0 ? '+' : ''}${amount}`);row.dataset.gain=String(delta>0);comparison.append(row);
    }
}
