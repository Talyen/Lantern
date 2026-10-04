import type { CharacterSave } from '../gameplay/character';
import { equipmentCatalog, type ItemId } from '../gameplay/equipment';
import { lootDefinitions, type InventoryItem } from '../gameplay/inventory';
import { skillLevel, levelXp } from '../gameplay/skills';
import { learnedRecipes, recipeMaterials, forgeError, reclaimable, reclaimError, salvageReturns, smithing, smithingXp, type SmithingContainer } from '../gameplay/smithing';
import { inventoryArt } from './inventory-art';
import { renderItemProperties } from './equipment-details';
import { bindMenuDismissal } from './menu';
import './smithing.css';

type Context = {
  character():CharacterSave;
  backgrounded():boolean;
  clear():void;
  focus():void;
  sound(cue:'menuOpen' | 'menuClose' | 'equip'):void;
  forge(item:ItemId):string[];
  reclaim(id:string,container:SmithingContainer):string[];
};
type Selection = {item:ItemId} | {id:string;container:SmithingContainer};
/** Presentation owns a cancellable foreground clock; only Adventure commits the transaction. */
export class SmithingPanel {
  readonly dialog=document.createElement('dialog');
  private level=document.createElement('span');
  private xp=document.createElement('span');
  private xpBar=document.createElement('progress');
  private tabs=document.createElement('nav');
  private list=document.createElement('nav');
  private details=document.createElement('section');
  private status=document.createElement('p');
  private mode:'forge' | 'reclaim'='forge';
  private selection:Selection | null=null;
  private pending: {item:ItemId;elapsed:number;last:number} | null=null;
  private progress:HTMLProgressElement | null=null;
  private frameId=0;
  private disposed=false;
  private visibility=()=>{if(this.pending)this.pending.last=0;};
  constructor(private ctx:Context) {
    this.dialog.id='smithing-dialog';this.dialog.setAttribute('aria-labelledby','smithing-title');
    const header=document.createElement('header'),heading=document.createElement('h2'),close=document.createElement('button'),progress=document.createElement('div');
    heading.id='smithing-title';heading.textContent='Smithing';
    close.type='button';close.className='smith-close';close.textContent='×';close.setAttribute('aria-label','Close Smithing');close.onclick=()=>this.close();
    progress.className='smith-level';this.xpBar.max=1;this.xpBar.setAttribute('aria-label','Smithing level progress');progress.append(this.level,this.xpBar,this.xp);
    header.append(heading,progress,close);
    this.tabs.className='smith-tabs';this.tabs.setAttribute('role','tablist');this.tabs.setAttribute('aria-label','Smithing actions');
    for(const mode of ['forge','reclaim'] as const) {
      const button=document.createElement('button');button.type='button';button.dataset.mode=mode;button.textContent=mode==='forge' ? 'Forge' : 'Reclaim';button.setAttribute('role','tab');
      button.id='smith-tab-'+mode;button.setAttribute('aria-controls','smith-content');
      button.onclick=()=>{if(this.pending)return;this.mode=mode;this.selection=null;this.status.textContent='';this.render();};
      button.onkeydown=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)&&!this.pending){event.preventDefault();const other=this.tabs.querySelector<HTMLButtonElement>('[data-mode="'+(mode==='forge'?'reclaim':'forge')+'"]')!;other.click();other.focus();}};
      this.tabs.append(button);
    }
    const body=document.createElement('div');body.id='smith-content';body.className='smith-body';body.setAttribute('role','tabpanel');
    this.list.className='smith-list';this.list.setAttribute('aria-label','Smithing choices');
    this.details.className='smith-details';
    this.status.className='smith-status';this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
    body.append(this.list,this.details);this.dialog.append(header,this.tabs,body,this.status);document.body.append(this.dialog);
    bindMenuDismissal(this.dialog,()=>this.close());
    this.dialog.addEventListener('keydown',event=>{if(event.repeat && ['Enter',' '].includes(event.key))event.preventDefault();});
    document.addEventListener('visibilitychange',this.visibility);
  }
  get paused():boolean{return this.dialog.open;}
  open():void {
    if(this.disposed || this.dialog.open)return;
    this.ctx.clear();this.mode='forge';this.selection=null;this.status.textContent='';this.render();this.dialog.showModal();this.ctx.sound('menuOpen');
    this.list.querySelector<HTMLButtonElement>('button')?.focus();
  }
  close():void {
    if(!this.dialog.open)return;
    const cancelled=!!this.pending;this.cancel(false);this.dialog.close();this.ctx.clear();this.ctx.focus();this.ctx.sound('menuClose');
    if(cancelled)this.status.textContent='Forging cancelled.';
  }
  dispose():void{this.close();this.disposed=true;document.removeEventListener('visibilitychange',this.visibility);this.dialog.remove();}
  private row(name:string,source:string,selected:boolean,choose:()=>void):HTMLButtonElement {
    const button=document.createElement('button');button.type='button';button.className='smith-choice';button.disabled=!!this.pending;button.setAttribute('aria-pressed',String(selected));
    const label=document.createElement('span');label.textContent=name;button.append(label);
    if(source){const origin=document.createElement('small');origin.textContent=source;button.append(origin);}
    button.onclick=()=>{if(this.pending)return;choose();this.status.textContent='';this.render();this.list.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();};
    return button;
  }
  private render():void {
    const character=this.ctx.character(),level=skillLevel(character.xp.smithing,'smithing'),floor=levelXp(level,'smithing'),ceiling=levelXp(level+1,'smithing');
    this.level.textContent='Level '+level;this.xp.textContent=Math.floor(character.xp.smithing-floor).toLocaleString()+' / '+(ceiling-floor).toLocaleString()+' XP';this.xpBar.value=(character.xp.smithing-floor)/(ceiling-floor);
    this.dialog.setAttribute('aria-busy',String(!!this.pending));
    this.dialog.querySelector('#smith-content')!.setAttribute('aria-labelledby','smith-tab-'+this.mode);
    for(const tab of Array.from(this.tabs.querySelectorAll<HTMLButtonElement>('button'))){const active=tab.dataset.mode===this.mode;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;tab.disabled=!!this.pending;}
    this.list.replaceChildren();this.details.replaceChildren();this.progress=null;
    let entry:InventoryItem | undefined;
    if(this.mode==='forge') {
      const recipes=learnedRecipes(character.xp.smithing);
      if(!this.selection || !('item' in this.selection))this.selection={item:recipes[0].item};
      for(const recipe of recipes)this.list.append(this.row(equipmentCatalog[recipe.item].name,'',!!this.selection&&'item' in this.selection&&this.selection.item===recipe.item,()=>{this.selection={item:recipe.item};}));
      const selected=this.selection;
      if(selected&&'item' in selected)entry={id:'recipe',item:selected.item,quantity:1,slot:'bag',x:0,y:0};
    } else {
      const choices=reclaimable(character);
      for(const choice of choices)this.list.append(this.row(lootDefinitions[choice.entry.item].name,choice.container==='bag' ? choice.entry.slot==='overflow' ? 'Bag · Recovery' : 'Bag' : 'Stash',
        !!this.selection&&'id' in this.selection&&this.selection.id===choice.entry.id&&this.selection.container===choice.container,
        ()=>{this.selection={id:choice.entry.id,container:choice.container};}));
      if(this.selection&&'id' in this.selection){const selected=this.selection;entry=choices.find(choice=>choice.entry.id===selected.id&&choice.container===selected.container)?.entry;if(!entry)this.selection=null;}
      if(!choices.length){const empty=document.createElement('p');empty.className='smith-empty';empty.textContent='No unequipped metal gear.';this.list.append(empty);}
    }
    if(!entry){const empty=document.createElement('p');empty.className='smith-empty';empty.textContent='Select metal gear to reclaim.';this.details.append(empty);return;}
    const output=document.createElement('div'),art=document.createElement('div'),information=document.createElement('div'),title=document.createElement('h3'),properties=document.createElement('div');
    output.className='smith-output';art.className='smith-art';art.innerHTML=inventoryArt(entry.item);title.textContent=lootDefinitions[entry.item].name;properties.className='smith-properties';
    if(this.mode==='forge')renderItemProperties(properties,entry);
    else if(this.selection&&'container' in this.selection)properties.textContent=this.selection.container==='bag'?'Bag':'Stash';
    information.append(title,properties);output.append(art,information);this.details.append(output);
    const materials=document.createElement('div');materials.className='smith-materials';const reward=document.createElement('p');reward.className='smith-reward';const action=document.createElement('button');action.type='button';action.className='smith-primary';
    if(this.mode==='forge'&&this.selection&&'item' in this.selection){
      const item=this.selection.item,recipe=learnedRecipes(character.xp.smithing).find(recipe=>recipe.item===item)!;
      for(const material of recipeMaterials(character,recipe)){
        const row=document.createElement('div');row.className='smith-material';
        const cost=document.createElement('strong');cost.textContent=material.cost+' '+lootDefinitions[material.item].name;
        const held=document.createElement('span');held.textContent=material.held+' available';const source=document.createElement('small');source.textContent='Bag '+material.bag+' · Stash '+material.stash;
        const numbers=document.createElement('div');numbers.append(held,source);row.append(cost,numbers);row.dataset.ready=String(material.held>=material.cost);materials.append(row);
      }
      reward.textContent='+'+smithingXp(character,recipe.xp).toLocaleString()+' Smithing XP';
      const error=forgeError(character,item);
      action.textContent='Forge';action.disabled=!!error;action.onclick=()=>{if(!this.pending)this.begin(item);};
      this.details.append(materials,reward);
      if(this.pending){
        const region=document.createElement('div');region.className='smith-forging';const label=document.createElement('span');label.textContent='Forging…';this.progress=document.createElement('progress');this.progress.max=smithing.forgeSeconds;this.progress.value=this.pending.elapsed;this.progress.setAttribute('aria-label','Forging progress');
        const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>this.cancel();region.append(label,this.progress,cancel);this.details.append(region);
      }else {if(error){const notice=document.createElement('p');notice.className='smith-error';notice.textContent=error;this.details.append(notice);}this.details.append(action);}
    }else if(this.selection&&'id' in this.selection){
      const selected=this.selection,returns=salvageReturns(entry.item)!;
      for(const [material,quantity] of Object.entries(returns)){const row=document.createElement('div');row.className='smith-material';row.textContent=quantity+' '+(material==='gold' ? 'Gold' : lootDefinitions[material as 'iron' | 'wood'].name);materials.append(row);}
      reward.textContent='+'+smithingXp(character,smithing.reclaimXp).toLocaleString()+' Smithing XP';
      const error=reclaimError(character,selected.id,selected.container);
      action.textContent='Reclaim';action.disabled=!!error;
      action.onclick=()=>{if(this.pending||action.disabled)return;try{const previous=character.xp.smithing,name=lootDefinitions[entry!.item].name,learned=this.ctx.reclaim(selected.id,selected.container);this.selection=null;this.render();this.announce('Reclaimed '+name+' · '+Object.entries(returns).map(([material,quantity])=>'+'+quantity+' '+(material==='gold' ? 'Gold' : lootDefinitions[material as 'iron' | 'wood'].name)).join(', ')+' · +'+(this.ctx.character().xp.smithing-previous).toLocaleString()+' Smithing XP',learned);this.ctx.sound('equip');}catch(error){this.status.textContent=error instanceof Error?error.message:'Unable to reclaim.';}};
      const heading=document.createElement('h4');heading.textContent='Recovered Materials';this.details.append(heading,materials,reward);
      const destroy=document.createElement('p');destroy.className='smith-destroy';destroy.textContent='Destroys this item.';this.details.append(destroy);
      if(error){const notice=document.createElement('p');notice.className='smith-error';notice.textContent=error;this.details.append(notice);}this.details.append(action);
    }
  }
  private announce(result:string,learned:string[]):void{this.status.textContent=result+(learned.length ? ' · Learned '+learned.join(', ') : '');}
  private begin(item:ItemId):void {
    const error=forgeError(this.ctx.character(),item);if(error){this.status.textContent=error;this.render();return;}
    this.status.textContent='';this.pending={item,elapsed:0,last:0};this.render();this.details.querySelector<HTMLButtonElement>('.smith-forging button')?.focus();
    const tick=(time:number)=>{
      const pending=this.pending;if(!pending||!this.dialog.open||this.disposed)return;
      if(this.ctx.backgrounded()){pending.last=0;}else{
        if(pending.last)pending.elapsed+=Math.min(.1,(time-pending.last)/1000);pending.last=time;
      }
      if(this.progress)this.progress.value=pending.elapsed;
      if(pending.elapsed>=smithing.forgeSeconds){
        this.pending=null;this.frameId=0;
        try{const previous=this.ctx.character().xp.smithing,learned=this.ctx.forge(pending.item);this.render();this.announce('Forged '+equipmentCatalog[pending.item].name+' · +'+(this.ctx.character().xp.smithing-previous).toLocaleString()+' Smithing XP',learned);this.ctx.sound('equip');}
        catch(error){this.render();this.status.textContent=error instanceof Error?error.message:'Unable to forge. Materials retained.';}
        return;
      }
      this.frameId=requestAnimationFrame(tick);
    };
    this.frameId=requestAnimationFrame(tick);
  }
  private cancel(render=true):void{
    const pending=!!this.pending;this.pending=null;cancelAnimationFrame(this.frameId);this.frameId=0;
    if(render&&this.dialog.open){this.render();if(pending)this.status.textContent='Forging cancelled.';this.details.querySelector<HTMLButtonElement>('.smith-primary')?.focus();}
  }
}
