import type { CharacterSave } from './character';
import { equipmentCatalog, isItemId, type ItemId, type SalvageReturns } from './equipment';
import { consumeMaterial, countItem, receive, validItems, validStash } from './inventory';
import { progressMultiplier, skillLevel } from './skills';

export type SmithingMaterial = 'iron' | 'wood';
export type SmithingRecipe = { item: ItemId; level: number; materials: Partial<Record<SmithingMaterial, number>>; xp: number };
export const smithingRecipes: readonly SmithingRecipe[] = [
  {item:'sword',level:1,materials:{iron:2,wood:1},xp:250},
  {item:'shield',level:1,materials:{iron:2,wood:3},xp:250},
  {item:'guard-helm',level:3,materials:{iron:3},xp:1000},
  {item:'weathered-mail',level:6,materials:{iron:4},xp:3000},
  {item:'iron-broadsword',level:10,materials:{iron:4,wood:1},xp:4000},
];
export const smithing = { forgeSeconds:2, reclaimXp:20, heatLevel:3, heatResistance:.15, hammerLevel:6, hammerDamage:.05, reach:1.8 };
export const smithingMeleeMultiplier = (xp:number) => skillLevel(xp,'smithing')>=smithing.hammerLevel ? 1+smithing.hammerDamage : 1;
export type SmithingState = Pick<CharacterSave,'items' | 'stash' | 'gold' | 'xp' | 'restedSeconds' | 'shelterRestored'>;
export type SmithingContainer = 'bag' | 'stash';
export const learnedRecipes = (xp:number) => smithingRecipes.filter(recipe => skillLevel(xp,'smithing') >= recipe.level);
export const smithingXp = (state:Pick<SmithingState,'restedSeconds'>,amount:number) => Math.round(amount * progressMultiplier(state.restedSeconds) * 1e6) / 1e6;
export function recipeMaterials(state:SmithingState,recipe:SmithingRecipe) {
  const carried = state.items.filter(entry => entry.slot === 'bag');
  return (Object.entries(recipe.materials) as [SmithingMaterial,number][]).map(([item,cost]) => {
    const bag=countItem(carried,item);
    const stash=state.shelterRestored ? countItem(state.stash,item) : 0;
    return {item,cost,bag,stash,held:bag+stash};
  });
}
function recipeFor(state:SmithingState,item:ItemId):SmithingRecipe {
  const recipe=learnedRecipes(state.xp.smithing).find(recipe=>recipe.item===item);
  if (!recipe) throw new Error('Recipe is not learned.');
  return recipe;
}
function checked(state:SmithingState):SmithingState {
  if (!Number.isFinite(state.xp.smithing) || state.xp.smithing<0 || state.xp.smithing>Number.MAX_SAFE_INTEGER) throw new Error('Smithing progress is full.');
  if (!validItems(state.items) || !validStash(state.stash,state.items)) throw new Error('Items do not fit.');
  return state;
}
/** Candidates include placement and XP; callers publish exactly once after the forge completes. */
export function forged(state:SmithingState,item:ItemId,newId:()=>string):SmithingState {
  const recipe=recipeFor(state,item);
  for (const material of recipeMaterials(state,recipe))
    if (material.held<material.cost) throw new Error('Need '+(material.cost-material.held)+' more '+(material.item==='iron' ? 'Iron' : 'Wood')+'.');
  const items=structuredClone(state.items),stash=structuredClone(state.stash);
  for (const [material,cost] of Object.entries(recipe.materials) as [SmithingMaterial,number][]) {
    const remaining=consumeMaterial(items,material,cost);
    if (remaining && consumeMaterial(stash,material,remaining)) throw new Error('Materials are no longer available.');
  }
  const next={...state,items:items.filter(entry=>entry.quantity>0),stash:stash.filter(entry=>entry.quantity>0),
    xp:{...state.xp,smithing:state.xp.smithing+smithingXp(state,recipe.xp)}};
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
export function reclaimable(state:SmithingState) {
  return [
    ...state.items.filter(entry=>(entry.slot==='bag' || entry.slot==='overflow') && salvageReturns(entry.item)).map(entry=>({entry,container:'bag' as const})),
    ...(state.shelterRestored ? state.stash.filter(entry=>salvageReturns(entry.item)).map(entry=>({entry,container:'stash' as const})) : []),
  ];
}
/** Removal, matching returns and XP are indivisible; equipped and stale IDs never qualify. */
export function reclaimed(state:SmithingState,id:string,container:SmithingContainer,newId:()=>string):SmithingState {
  const selected=reclaimable(state).find(choice=>choice.entry.id===id && choice.container===container);
  if (!selected) throw new Error('Select unequipped metal gear.');
  const returns=salvageReturns(selected.entry.item)!;
  const next={...state,items:structuredClone(state.items),stash:structuredClone(state.stash),
    xp:{...state.xp,smithing:state.xp.smithing+smithingXp(state,smithing.reclaimXp)}};
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
