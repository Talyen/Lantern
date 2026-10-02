import { abilities, abilityIds, abilitySet, type AbilityId, type ActionBar } from '../gameplay/abilities';
import type { CharacterSave } from '../gameplay/character';
import type { Encounter } from '../gameplay/encounter';
import { bindingLabel, actionSlotInputs, type InputPreferences } from '../input/bindings';
import { abilityIcon } from './ability-icons';
import { itemIcon } from './item-icons';
import { setText, setAttribute, setDisabled } from './dom';
import './combat.css';

type Context={character():CharacterSave;encounter():Encounter;preferences:InputPreferences;activate(id:AbilityId):void;potion():void;portal():void;swap():void;canEdit():boolean;portalReady():boolean;assign(bar:ActionBar):void;clear():void;focus():void};
type Drag={id:AbilityId;slot?:number;x:number;y:number;active:boolean;pointer:number};
type SlotElements={button:HTMLButtonElement;icon:HTMLElement;cooldown:HTMLElement;key:HTMLElement};
type UtilityElements={button:HTMLButtonElement;count:Element;key:Element};
export class CombatUI {
  readonly bar=document.createElement('nav');
  private dialog=document.createElement('dialog');
  private nodes=document.createElement('div');
  private ghost=document.createElement('div');
  private status=document.createElement('p');
  private buttons:HTMLButtonElement[]=[];
  private slots:SlotElements[]=[];
  private utilities:UtilityElements[]=[];
  private potion=document.createElement('button');
  private portal=document.createElement('button');
  private swap=document.createElement('button');
  private selected:AbilityId | null=null;
  private family='sword';
  private drag:Drag | null=null;
  private held:AbilityId | null=null;
  private heldPointer:number | null=null;
  private heldKey:string | null=null;
  private ignoreClickUntil=0;
  constructor(private ctx:Context){
    this.bar.id='action-bar';this.bar.setAttribute('aria-label','Action bar');
    this.potion.className=this.portal.className='utility-slot';this.potion.innerHTML=itemIcon('potion')+'<span class="supply-count"></span><kbd></kbd>';this.portal.innerHTML=itemIcon('scroll')+'<span class="supply-count"></span><kbd></kbd>';
    this.utilities=[this.potion,this.portal].map(button=>({button,count:button.querySelector('.supply-count')!,key:button.querySelector('kbd')!}));
    this.potion.onclick=()=>{if(!this.paused){this.ctx.potion();this.ctx.focus();}};this.portal.onclick=()=>{if(!this.paused){this.ctx.portal();this.ctx.focus();}};this.bar.append(this.potion);
    const slots=document.createElement('div');slots.className='action-slots';
    for(const [i] of actionSlotInputs.entries()){
      const button=document.createElement('button');button.type='button';button.className='action-slot';button.dataset.slot=String(i);button.innerHTML='<span class="ability-icon"></span><span class="cooldown-value"></span><kbd></kbd>';
      this.slots.push({button,icon:button.querySelector<HTMLElement>('.ability-icon')!,cooldown:button.querySelector<HTMLElement>('.cooldown-value')!,key:button.querySelector('kbd')!});
      button.onclick=event=>{if(performance.now()<this.ignoreClickUntil)return;if(this.paused && !this.drag?.active && this.selected && this.ctx.canEdit()){const bar=[...this.ctx.character().actionBar];bar[i]=this.selected;this.ctx.assign(bar);this.update();}else if(!this.paused && event.detail===0){const id=this.ctx.character().actionBar[i];if(id){this.ctx.activate(id);this.ctx.focus();}}};
      button.onkeydown=event=>{
        if(this.paused || !['Enter',' '].includes(event.key))return;
        event.preventDefault();event.stopPropagation();if(event.repeat)return;
        const id=this.ctx.character().actionBar[i];if(!id)return;
        if(abilities[id].activation==='hold'){this.held=id;this.heldKey=event.key;this.heldPointer=null;}
        this.ctx.activate(id);this.ctx.focus();
      };
      button.onpointerdown=event=>{
        if(event.button!==0 || this.drag && this.drag.pointer!==event.pointerId || this.heldPointer!==null && this.heldPointer!==event.pointerId)return;
        const id=this.ctx.character().actionBar[i];
        if(this.paused){if(!this.ctx.canEdit() || !id || this.selected)return;this.drag={id,slot:i,x:event.clientX,y:event.clientY,active:false,pointer:event.pointerId};button.setPointerCapture(event.pointerId);}
        else if(id){event.preventDefault();this.held=abilities[id].activation==='hold' ? id : null;this.heldPointer=this.held ? event.pointerId : null;this.heldKey=null;this.ctx.activate(id);}
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
    window.addEventListener('pointermove',event=>{if(!this.drag || event.pointerId!==this.drag.pointer)return;if(Math.hypot(event.clientX-this.drag.x,event.clientY-this.drag.y)>5)this.drag.active=true;if(!this.drag.active)return;this.ghost.innerHTML=abilityIcon(this.drag.id);this.ghost.hidden=false;this.ghost.style.left=`${event.clientX}px`;this.ghost.style.top=`${event.clientY}px`;this.buttons.forEach(button=>{const rect=button.getBoundingClientRect();button.classList.toggle('drop-target',event.clientX>=rect.left && event.clientX<=rect.right && event.clientY>=rect.top && event.clientY<=rect.bottom);});});
    window.addEventListener('pointerup',event=>{
      if(event.button!==0)return;
      if(event.pointerId===this.heldPointer){this.held=null;this.heldPointer=null;}
      const drag=this.drag;if(drag && event.pointerId!==drag.pointer)return;this.drag=null;this.ghost.hidden=true;this.buttons.forEach(button=>button.classList.remove('drop-target'));
      if(!drag?.active || !this.ctx.canEdit())return;this.ignoreClickUntil=performance.now()+100;
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-slot]'),bar=[...this.ctx.character().actionBar];
      if(target){const slot=Number(target.dataset.slot);if(drag.slot!==undefined)bar[drag.slot]=bar[slot];bar[slot]=drag.id;}
      else if(drag.slot!==undefined)bar[drag.slot]=null;
      this.selected=null;this.ctx.assign(bar);this.update();this.renderTree();
    });
    window.addEventListener('keyup',event=>{if(event.key===this.heldKey){event.preventDefault();this.held=null;this.heldKey=null;this.ctx.focus();}});
    window.addEventListener('pointercancel',event=>{if(event.pointerId===this.heldPointer || event.pointerId===this.drag?.pointer)this.clearHold();});window.addEventListener('blur',()=>this.clearHold());this.ghost.hidden=true;this.update();
  }
  get paused():boolean{return this.dialog.open;}
  get blocking():boolean{return this.held==='shield-basic';}
  clearHold():void{this.held=null;this.heldPointer=null;this.heldKey=null;this.drag=null;this.ghost.hidden=true;this.buttons.forEach(button=>button.classList.remove('drop-target'));}
  open():void{this.ctx.clear();this.selected=null;this.dialog.append(this.bar);this.dialog.showModal();this.renderTree();this.update();}
  close():void{this.clearHold();this.dialog.close();document.getElementById('app')!.append(this.bar);this.ctx.clear();this.ctx.focus();}
  private renderTree():void{
    this.nodes.replaceChildren();this.dialog.querySelectorAll<HTMLElement>('[data-family]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.family===this.family)));
    for(const id of abilityIds.filter(id=>abilities[id].family===this.family)){
      const button=document.createElement('button');button.type='button';button.className='skill-node';button.innerHTML=abilityIcon(id);button.title=this.tooltip(id);button.setAttribute('aria-label',abilities[id].name);button.disabled=!this.ctx.canEdit();
      const label=document.createElement('span');label.textContent=abilities[id].motion==='attack' || abilities[id].motion==='block' ? 'Basic' : abilities[id].name;button.append(label);button.setAttribute('aria-pressed',String(this.selected===id));
      button.onclick=()=>{if(performance.now()<this.ignoreClickUntil)return;this.selected=this.selected===id ? null : id;this.renderTree();};
      button.onpointerdown=event=>{if(event.button===0 && this.ctx.canEdit() && (!this.drag || this.drag.pointer===event.pointerId)){this.drag={id,x:event.clientX,y:event.clientY,active:false,pointer:event.pointerId};button.setPointerCapture(event.pointerId);}};this.nodes.append(button);
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
    this.slots.forEach(({button,icon,cooldown:cooldownValue,key},index)=>{
      const id=character.actionBar[index];
      if(icon.dataset.ability!==(id ?? '')){icon.dataset.ability=id ?? '';icon.innerHTML=id ? abilityIcon(id) : '';}
      const cooldown=id ? state.abilityCooldowns[id] ?? 0 : 0, unavailable=!!id && (abilitySet(state.weaponSets,state.activeSet,id)===undefined || state.playerMana<abilities[id].mana || cooldown>0 || state.player.hp<=0);
      button.classList.toggle('unavailable',!this.paused && unavailable);button.classList.toggle('empty',!id);
      const fill=String(id && abilities[id].cooldown ? cooldown/abilities[id].cooldown : 0);
      if(button.style.getPropertyValue('--cooldown')!==fill)button.style.setProperty('--cooldown',fill);
      setText(cooldownValue,cooldown>0 ? String(Math.ceil(cooldown)) : '');
      setText(key,bindingLabel(preferences[actionSlotInputs[index]].find(Boolean) ?? null));
      const tooltip=id ? this.tooltip(id) : 'Empty';
      setAttribute(button,'title',tooltip);setAttribute(button,'aria-label',id ? tooltip : `Empty slot ${index+1}`);setDisabled(button,this.paused && !this.ctx.canEdit());
    });
    this.utility(this.utilities[0],'potion',character.potions,state.potionCooldown,character.potions===0 || state.player.hp<=0 || state.player.hp>=state.stats.maxHealth || state.potionCooldown>0,'Health Potion');
    this.utility(this.utilities[1],'portal',character.scrolls,0,!this.ctx.portalReady(),'Scroll of Return');
    setText(this.swap,`${state.activeSet===0 ? 'I' : 'II'} · ${state.weapon ? state.weapon[0].toUpperCase()+state.weapon.slice(1) : 'Empty'} · ${bindingLabel(preferences.swap.find(Boolean) ?? null)}`);
    setAttribute(this.swap,'title','Swap weapons');setDisabled(this.swap,this.paused || !state.weaponSets[(1-state.activeSet) as 0|1].main);
  }
  private utility(elements:UtilityElements,action:'potion'|'portal',count:number,cooldown:number,unavailable:boolean,name:string):void{
    const title=`${name} · ${count}`;
    setText(elements.count,cooldown>0 ? `${Math.ceil(cooldown)}s` : String(count));setText(elements.key,bindingLabel(this.ctx.preferences.value[action].find(Boolean) ?? null));setAttribute(elements.button,'title',title);setAttribute(elements.button,'aria-label',title);setDisabled(elements.button,this.paused || unavailable);
  }
}
