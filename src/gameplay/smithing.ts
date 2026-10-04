import type { CharacterSave } from './character';
import { equipmentCatalog, isItemId, type ItemId, type SalvageReturns } from './equipment';
import { consumeMaterial, countItem, receive, validItems, validStash, type InventoryItem } from './inventory';
import { earnedSkillXp, withSkillXp, skillLevel, skillTree } from './skills';

export type SmithingMaterial = 'iron' | 'wood';
export type SmithingRecipe = { item: ItemId; level: number; materials: Partial<Record<SmithingMaterial, number>>; xp: number };
export const smithingRecipes: readonly SmithingRecipe[] = [
  {item:'sword',level:1,materials:{iron:2,wood:1},xp:250},
  {item:'shield',level:1,materials:{iron:2,wood:3},xp:250},
  {item:'guard-helm',level:3,materials:{iron:3},xp:350},
  {item:'weathered-mail',level:6,materials:{iron:4},xp:500},
  {item:'iron-broadsword',level:10,materials:{iron:4,wood:1},xp:650},
];
export const smithing = { forgeSeconds:2, reclaimXp:20, heatLevel:skillTree.passives[0], heatResistance:.15, hammerLevel:skillTree.passives[1], hammerDamage:.05, reach:1.8 };
export const smithingMeleeMultiplier = (xp:number) => skillLevel(xp)>=smithing.hammerLevel ? 1+smithing.hammerDamage : 1;
export type SmithingState = Pick<CharacterSave,'items' | 'stash' | 'gold' | 'xp' | 'restedSeconds' | 'shelterRestored'>;
export type SmithingContainer = 'bag' | 'stash';
export const learnedRecipes = (xp:number) => smithingRecipes.filter(recipe => skillLevel(xp) >= recipe.level);
export const smithingXp = (state:Pick<SmithingState,'restedSeconds'>,amount:number) => earnedSkillXp(amount,state.restedSeconds);
export function recipeMaterials(state:SmithingState,recipe:SmithingRecipe) {
  const carried = state.items.filter(entry => entry.slot === 'bag');
  return (Object.entries(recipe.materials) as [SmithingMaterial,number][]).map(([item,cost]) => {
    const bag=countItem(carried,item);
    const stash=state.shelterRestored ? countItem(state.stash,item) : 0;
    return {item,cost,bag,stash,held:bag+stash};
  });
}
function checked(state:SmithingState):SmithingState {
  if (!Number.isFinite(state.xp.smithing) || state.xp.smithing<0 || state.xp.smithing>Number.MAX_SAFE_INTEGER) throw new Error('Smithing progress is full.');
  if (!validItems(state.items) || !validStash(state.stash,state.items)) throw new Error('Items do not fit.');
  return state;
}
/** Candidates include placement and XP; callers publish exactly once after the forge completes. */
export function forged(state:SmithingState,item:ItemId,newId:()=>string):SmithingState {
  const recipe = learnedRecipes(state.xp.smithing).find(recipe => recipe.item === item);
  if (!recipe) throw new Error('Recipe is not learned.');
  for (const material of recipeMaterials(state,recipe))
    if (material.held<material.cost) throw new Error('Need '+(material.cost-material.held)+' more '+(material.item==='iron' ? 'Iron' : 'Wood')+'.');
  const next = { ...state, items: structuredClone(state.items), stash: structuredClone(state.stash),
    xp: withSkillXp(state.xp,'smithing',recipe.xp,state.restedSeconds) };
  for (const [material,cost] of Object.entries(recipe.materials) as [SmithingMaterial,number][]) {
    const remaining=consumeMaterial(next.items,material,cost);
    if (remaining && consumeMaterial(next.stash,material,remaining)) throw new Error('Materials are no longer available.');
  }
  next.items = next.items.filter(entry => entry.quantity > 0);
  next.stash = next.stash.filter(entry => entry.quantity > 0);
  if (receive(next.items,item,1,newId)!==1) throw new Error('Not enough room in Bag.');
  return checked(next);
}
function previewIds(state:SmithingState):()=>string {
  const used=new Set([...state.items,...state.stash].map(entry=>entry.id));let sequence=0;
  return()=>{let id;do{id='smithing-preview-'+(++sequence);}while(used.has(id));used.add(id);return id;};
}
export function forgeError(state:SmithingState,item:ItemId):string {
  try { forged(state,item,previewIds(state)); return ''; }
  catch(error) { return error instanceof Error ? error.message : 'Cannot forge this recipe.'; }
}
export function salvageReturns(item:unknown):SalvageReturns | undefined {
  return isItemId(item) ? equipmentCatalog[item].salvage : undefined;
}
function reclaimEntries(state: SmithingState, container: SmithingContainer): InventoryItem[] {
  return container === 'bag' ? state.items : state.shelterRestored ? state.stash : [];
}
function canReclaim(entry: InventoryItem): boolean {
  return (entry.slot === 'bag' || entry.slot === 'overflow') && !!salvageReturns(entry.item);
}
export function reclaimable(state:SmithingState) {
  return (['bag', 'stash'] as const).flatMap(container =>
    reclaimEntries(state, container).filter(canReclaim).map(entry => ({ entry, container })));
}
/** Removal, matching returns and XP are indivisible; equipped and stale IDs never qualify. */
export function reclaimed(state:SmithingState,id:string,container:SmithingContainer,newId:()=>string):SmithingState {
  const selected = reclaimEntries(state, container).find(entry => entry.id === id && canReclaim(entry));
  if (!selected) throw new Error('Select unequipped metal gear.');
  const returns=salvageReturns(selected.item)!;
  const next = { ...state, items: structuredClone(state.items), stash: structuredClone(state.stash),
    xp: withSkillXp(state.xp,'smithing',smithing.reclaimXp,state.restedSeconds) };
  if (container==='bag') next.items=next.items.filter(entry=>entry.id!==id);
  else next.stash=next.stash.filter(entry=>entry.id!==id);
  const target=container==='bag' ? next.items : next.stash;
  for (const [material,quantity] of Object.entries(returns) as ['iron' | 'wood' | 'gold',number][]) {
    if (material==='gold') {
      if (!Number.isSafeInteger(next.gold+quantity)) throw new Error('Gold wallet is full.');
      next.gold+=quantity;
    } else if (receive(target,material,quantity,newId)!==quantity) throw new Error('Not enough room in '+(container==='bag' ? 'Bag.' : 'Stash.'));
  }
  return checked(next);
}
export function reclaimError(state:SmithingState,id:string,container:SmithingContainer):string {
  try { reclaimed(state,id,container,previewIds(state)); return ''; }
  catch(error) { return error instanceof Error ? error.message : 'Cannot reclaim this item.'; }
}
