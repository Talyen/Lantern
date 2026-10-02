import { abilities, abilityIds, abilitySet, type AbilityId, type ActionBar } from '../gameplay/abilities';
import type { CharacterSave } from '../gameplay/adventure';
import type { Encounter } from '../gameplay/encounter';
import { bindingLabel, type InputAction, type InputPreferences } from '../input/bindings';
import { abilityIcon } from './ability-icons';
import { itemIcon } from './item-icons';
import './combat.css';

type Context={character():CharacterSave;encounter():Encounter;preferences:InputPreferences;activate(id:AbilityId):void;potion():void;portal():void;swap():void;canEdit():boolean;portalReady():boolean;assign(bar:ActionBar):void;clear():void;focus():void};
type Drag={id:AbilityId;slot?:number;x:number;y:number;active:boolean};
export class CombatUI {
  readonly bar=document.createElement('nav');
  private dialog=document.createElement('dialog');
  private nodes=document.createElement('div');
  private ghost=document.createElement('div');
  private status=document.createElement('p');
  private buttons:HTMLButtonElement[]=[];
  private potion=document.createElement('button');
  private portal=document.createElement('button');
  private swap=document.createElement('button');
  private selected:AbilityId | null=null;
  private family='sword';
  private drag:Drag | null=null;
  private held:AbilityId | null=null;
  private ignoreClickUntil=0;
  constructor(private ctx:Context){
    this.bar.id='action-bar';this.bar.setAttribute('aria-label','Action bar');
    this.potion.className=this.portal.className='utility-slot';this.potion.innerHTML=itemIcon('potion')+'<span class="supply-count"></span><kbd></kbd>';this.portal.innerHTML=itemIcon('scroll')+'<span class="supply-count"></span><kbd></kbd>';
    this.potion.onclick=()=>{if(!this.paused){this.ctx.potion();this.ctx.focus();}};this.portal.onclick=()=>{if(!this.paused){this.ctx.portal();this.ctx.focus();}};this.bar.append(this.potion);
    const slots=document.createElement('div');slots.className='action-slots';
    for(let i=0;i<6;i++){
      const button=document.createElement('button');button.type='button';button.className='action-slot';button.dataset.slot=String(i);button.innerHTML='<span class="ability-icon"></span><span class="cooldown-value"></span><kbd></kbd>';
      button.onclick=()=>{if(performance.now()<this.ignoreClickUntil)return;if(this.paused && !this.drag?.active && this.selected && this.ctx.canEdit()){const bar=[...this.ctx.character().actionBar];bar[i]=this.selected;this.ctx.assign(bar);this.update();}};
      button.onpointerdown=event=>{
        if(event.button!==0)return;
        const id=this.ctx.character().actionBar[i];
        if(this.paused){if(!this.ctx.canEdit() || !id || this.selected)return;this.drag={id,slot:i,x:event.clientX,y:event.clientY,active:false};button.setPointerCapture(event.pointerId);}
        else if(id){event.preventDefault();this.held=abilities[id].activation==='hold' ? id : null;this.ctx.activate(id);}
      };
      this.buttons.push(button);slots.append(button);
    }
    this.bar.append(slots,this.portal);this.swap.className='weapon-set-switch';this.swap.onclick=()=>{if(!this.paused){this.ctx.swap();this.ctx.focus();}};this.bar.append(this.swap);document.getElementById('app')!.append(this.bar);
    this.dialog.id='skills-dialog';this.dialog.className='skills-shell';this.dialog.setAttribute('aria-labelledby','skills-title');
    const panel=document.createElement('section');panel.className='combat-menu skills-panel';panel.innerHTML='<header><h2 id="skills-title">Skills</h2><button type="button" data-close>Close</button></header>';
    const tabs=document.createElement('div');tabs.className='weapon-tabs';
    for(const family of ['sword','bow','axe','staff','shield']){const button=document.createElement('button');button.textContent=family[0].toUpperCase()+family.slice(1);button.dataset.family=family;button.onclick=()=>{this.family=family;this.selected=null;this.renderTree();};tabs.append(button);}
    this.nodes.className='weapon-tree';this.status.className='skills-status';this.status.setAttribute('role','status');panel.append(tabs,this.nodes,this.status);this.dialog.append(panel);document.getElementById('app')!.append(this.dialog);
    panel.querySelector<HTMLButtonElement>('[data-close]')!.onclick=()=>this.close();
    this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
    let outside=false;this.dialog.addEventListener('pointerdown',event=>{outside=event.target===this.dialog;});this.dialog.addEventListener('click',event=>{if(outside && event.target===this.dialog)this.close();outside=false;});
    this.ghost.className='ability-ghost';this.dialog.append(this.ghost);
    window.addEventListener('pointermove',event=>{if(!this.drag)return;if(Math.hypot(event.clientX-this.drag.x,event.clientY-this.drag.y)>5)this.drag.active=true;if(!this.drag.active)return;this.ghost.innerHTML=abilityIcon(this.drag.id);this.ghost.hidden=false;this.ghost.style.left=`${event.clientX}px`;this.ghost.style.top=`${event.clientY}px`;this.buttons.forEach(button=>{const rect=button.getBoundingClientRect();button.classList.toggle('drop-target',event.clientX>=rect.left && event.clientX<=rect.right && event.clientY>=rect.top && event.clientY<=rect.bottom);});});
    window.addEventListener('pointerup',event=>{
      this.held=null;const drag=this.drag;this.drag=null;this.ghost.hidden=true;this.buttons.forEach(button=>button.classList.remove('drop-target'));
      if(!drag?.active || !this.ctx.canEdit())return;this.ignoreClickUntil=performance.now()+100;
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-slot]'),bar=[...this.ctx.character().actionBar];
      if(target){const slot=Number(target.dataset.slot);if(drag.slot!==undefined)bar[drag.slot]=bar[slot];bar[slot]=drag.id;}
      else if(drag.slot!==undefined)bar[drag.slot]=null;
      this.selected=null;this.ctx.assign(bar);this.update();this.renderTree();
    });
    window.addEventListener('pointercancel',()=>this.clearHold());window.addEventListener('blur',()=>this.clearHold());this.ghost.hidden=true;this.update();
  }
  get paused():boolean{return this.dialog.open;}
  get blocking():boolean{return this.held==='shield-basic';}
  clearHold():void{this.held=null;this.drag=null;this.ghost.hidden=true;}
  open():void{this.ctx.clear();this.selected=null;this.dialog.append(this.bar);this.dialog.showModal();this.renderTree();this.update();}
  close():void{this.clearHold();this.dialog.close();document.getElementById('app')!.append(this.bar);this.ctx.clear();this.ctx.focus();}
  private renderTree():void{
    this.nodes.replaceChildren();this.dialog.querySelectorAll<HTMLElement>('[data-family]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.family===this.family)));
    for(const id of abilityIds.filter(id=>abilities[id].family===this.family)){
      const button=document.createElement('button');button.type='button';button.className='skill-node';button.innerHTML=abilityIcon(id);button.title=this.tooltip(id);button.setAttribute('aria-label',abilities[id].name);button.disabled=!this.ctx.canEdit();
      const label=document.createElement('span');label.textContent=abilities[id].motion==='attack' || abilities[id].motion==='block' ? 'Basic' : abilities[id].name;button.append(label);button.setAttribute('aria-pressed',String(this.selected===id));
      button.onclick=()=>{if(performance.now()<this.ignoreClickUntil)return;this.selected=this.selected===id ? null : id;this.renderTree();};
      button.onpointerdown=event=>{if(event.button===0 && this.ctx.canEdit()){this.drag={id,x:event.clientX,y:event.clientY,active:false};button.setPointerCapture(event.pointerId);}};this.nodes.append(button);
    }
    if(['sword','bow'].includes(this.family)){const locked=document.createElement('button');locked.type='button';locked.className='skill-node locked';locked.disabled=true;locked.innerHTML='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 22v-7a9 9 0 0 1 18 0v7M11 22h26v19H11zM24 29v5"/></svg><span>Ultimate</span>';locked.title='Locked';this.nodes.append(locked);}
    this.status.textContent=this.ctx.canEdit() ? this.selected ? `${abilities[this.selected].name} · Choose a slot` : '' : 'Assignments unavailable in combat.';
  }
  private tooltip(id:AbilityId):string{
    const definition=abilities[id],state=this.ctx.encounter();let text=definition.name;
    if(definition.mana)text+=` · ${definition.mana} mana · ${definition.cooldown}s cooldown`;
    if(definition.activation==='hold')text+=' · Hold to block';
    if(abilitySet(state.weaponSets,state.activeSet,id)===undefined)text+=` · Equip ${definition.family==='shield' ? 'a Shield' : definition.family==='axe' ? 'an Axe' : `a ${definition.family[0].toUpperCase()+definition.family.slice(1)}`} in a weapon set`;
    return text;
  }
  update():void{
    const character=this.ctx.character(),state=this.ctx.encounter(),preferences=this.ctx.preferences.value;
    this.bar.classList.toggle('editing',this.paused);
    this.buttons.forEach((button,index)=>{
      const id=character.actionBar[index],icon=button.querySelector<HTMLElement>('.ability-icon')!;
      if(icon.dataset.ability!==(id ?? '')){icon.dataset.ability=id ?? '';icon.innerHTML=id ? abilityIcon(id) : '';}
      const cooldown=id ? state.abilityCooldowns[id] ?? 0 : 0, unavailable=!!id && (abilitySet(state.weaponSets,state.activeSet,id)===undefined || state.playerMana<abilities[id].mana || cooldown>0 || state.player.hp<=0);
      button.classList.toggle('unavailable',!this.paused && unavailable);button.classList.toggle('empty',!id);button.style.setProperty('--cooldown',String(id && abilities[id].cooldown ? cooldown/abilities[id].cooldown : 0));
      button.querySelector<HTMLElement>('.cooldown-value')!.textContent=cooldown>0 ? String(Math.ceil(cooldown)) : '';
      button.querySelector('kbd')!.textContent=bindingLabel(preferences[`slot${index}` as InputAction].find(Boolean) ?? null);
      button.title=id ? this.tooltip(id) : 'Empty';button.setAttribute('aria-label',id ? this.tooltip(id) : `Empty slot ${index+1}`);button.disabled=this.paused && !this.ctx.canEdit();
    });
    this.utility(this.potion,'potion',character.potions,state.potionCooldown,character.potions===0 || state.player.hp<=0 || state.player.hp>=100 || state.potionCooldown>0,'Health Potion');
    this.utility(this.portal,'portal',character.scrolls,0,!this.ctx.portalReady(),'Scroll of Return');
    this.swap.textContent=`${state.activeSet===0 ? 'I' : 'II'} · ${state.weapon ? state.weapon[0].toUpperCase()+state.weapon.slice(1) : 'Empty'} · ${bindingLabel(preferences.swap.find(Boolean) ?? null)}`;
    this.swap.title='Swap weapons';this.swap.disabled=this.paused || !state.weaponSets[(1-state.activeSet) as 0|1].main;
  }
  private utility(button:HTMLButtonElement,action:'potion'|'portal',count:number,cooldown:number,unavailable:boolean,name:string):void{
    button.querySelector('.supply-count')!.textContent=cooldown>0 ? `${Math.ceil(cooldown)}s` : String(count);button.querySelector('kbd')!.textContent=bindingLabel(this.ctx.preferences.value[action].find(Boolean) ?? null);button.title=`${name} · ${count}`;button.setAttribute('aria-label',button.title);button.disabled=this.paused || unavailable;
  }
}
