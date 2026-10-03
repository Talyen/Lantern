import { abilities, abilitySet, type AbilityId, type ActionBar } from '../gameplay/abilities';
import type { CharacterSave } from '../gameplay/character';
import type { Encounter } from '../gameplay/encounter';
import { bindingLabel, actionSlotInputs, type InputPreferences } from '../input/bindings';
import { abilityIcon } from './ability-icons';
import { hudFrame, hudIcon } from './hud-art';
import { SkillsPanel } from './skills-panel';
import { setText, setAttribute, setDisabled } from './dom';
import { bindMenuDismissal } from './menu';
import './combat.css';

type Context={character():CharacterSave;encounter():Encounter;preferences:InputPreferences;activate(id:AbilityId):void;potion():void;portal():void;canEdit():boolean;portalReady():boolean;assign(bar:ActionBar):void;clear():void;focus():void};
type Drag={id:AbilityId;slot?:number;x:number;y:number;active:boolean;pointer:number};
type SlotElements={button:HTMLButtonElement;icon:HTMLElement;cooldown:HTMLElement;key:HTMLElement;caption:HTMLElement};
type UtilityElements={button:HTMLButtonElement;count:Element;key:Element};
export class CombatUI {
  readonly bar=document.createElement('nav');
  private dialog=document.createElement('dialog');
  private skills: SkillsPanel;
  private pickerOnly=false;
  private ghost=document.createElement('div');
  private buttons:HTMLButtonElement[]=[];
  private slots:SlotElements[]=[];
  private utilities:UtilityElements[]=[];
  private potion=document.createElement('button');
  private portal=document.createElement('button');

  private drag:Drag | null=null;
  private held:AbilityId | null=null;
  private heldPointer:number | null=null;
  private heldKey:string | null=null;
  private ignoreClickUntil=0;
  constructor(private ctx:Context){
    this.bar.id='action-bar';this.bar.setAttribute('aria-label','Action bar');
    this.potion.className=this.portal.className='utility-slot';this.potion.innerHTML=hudFrame('utility')+hudIcon('potion')+'<span class="supply-count"></span><kbd></kbd>';this.portal.innerHTML=hudFrame('utility')+hudIcon('scroll')+'<span class="supply-count"></span><kbd></kbd>';
    this.utilities=[this.potion,this.portal].map(button=>({button,count:button.querySelector('.supply-count')!,key:button.querySelector('kbd')!}));
    this.potion.onclick=()=>{if(!this.paused){this.ctx.potion();this.ctx.focus();}};this.portal.onclick=()=>{if(!this.paused){this.ctx.portal();this.ctx.focus();}};this.bar.append(this.potion, document.getElementById('player-health')!);
    this.potion.insertAdjacentHTML('beforeend','<span class="slot-caption">Potion</span>');this.portal.insertAdjacentHTML('beforeend','<span class="slot-caption">Return Scroll</span>');
    const slots=document.createElement('div');slots.className='action-slots';
    for(const [i] of actionSlotInputs.entries()){
      const button=document.createElement('button');button.type='button';button.className='action-slot';button.dataset.slot=String(i);button.innerHTML=hudFrame('slot')+'<span class="ability-icon"></span><span class="cooldown-shade" aria-hidden="true"></span><span class="cooldown-value"></span><kbd>'+hudFrame('key')+'<span></span></kbd><span class="slot-caption"></span>';
      this.slots.push({button,icon:button.querySelector<HTMLElement>('.ability-icon')!,cooldown:button.querySelector<HTMLElement>('.cooldown-value')!,key:button.querySelector('kbd>span:last-child')!,caption:button.querySelector('.slot-caption')!});
      button.onclick=event=>{
        if(performance.now()<this.ignoreClickUntil || this.drag?.active)return;
        const id=this.ctx.character().actionBar[i];
        if(!id && this.ctx.canEdit()){
          if(!this.paused){this.open();this.pickerOnly=true;this.skills.panel.hidden=true;}
          this.skills.openPicker(button,i);
        }else if(!this.paused && event.detail===0 && id){this.ctx.activate(id);this.ctx.focus();}
      };
      button.onkeydown=event=>{
        if(!['Enter',' '].includes(event.key))return;
        if(this.paused){
          event.preventDefault();event.stopPropagation();
          if(!event.repeat && this.ctx.canEdit())this.skills.openPicker(button,i);
          return;
        }
        event.preventDefault();event.stopPropagation();if(event.repeat)return;
        const id=this.ctx.character().actionBar[i];
        if(!id){
          if(this.ctx.canEdit()){this.open();this.pickerOnly=true;this.skills.panel.hidden=true;this.skills.openPicker(button,i);}
          return;
        }
        if(abilities[id].activation==='hold'){this.held=id;this.heldKey=event.key;this.heldPointer=null;}
        this.ctx.activate(id);this.ctx.focus();
      };
      button.onpointerdown=event=>{
        if(event.button!==0 || this.drag && this.drag.pointer!==event.pointerId || this.heldPointer!==null && this.heldPointer!==event.pointerId)return;
        const id=this.ctx.character().actionBar[i];
        if(this.paused){if(!this.ctx.canEdit() || !id)return;this.skills.closePicker(false);this.drag={id,slot:i,x:event.clientX,y:event.clientY,active:false,pointer:event.pointerId};button.setPointerCapture(event.pointerId);}
        else if(id){event.preventDefault();this.held=abilities[id].activation==='hold' ? id : null;this.heldPointer=this.held ? event.pointerId : null;this.heldKey=null;this.ctx.activate(id);}
      };
      this.buttons.push(button);slots.append(button);
    }
    this.bar.append(slots,document.getElementById('player-mana')!,this.portal);document.getElementById('app')!.append(this.bar);
    this.dialog.id='skills-dialog';this.dialog.className='skills-shell';this.dialog.setAttribute('aria-labelledby','skills-title');
    this.skills=new SkillsPanel({
      dialog:this.dialog,character:()=>this.ctx.character(),canEdit:()=>this.ctx.canEdit(),
      abilityInfo:id=>this.tooltip(id),beginDrag:(id,event)=>this.beginDrag(id,event),
      assignSlot:(index,id)=>{
        if(!this.ctx.canEdit())return;
        const bar=[...this.ctx.character().actionBar];bar[index]=id;this.ctx.assign(bar);this.update();
        if(this.pickerOnly)this.close();
      },close:()=>this.close(),
    });
    const dismiss=()=>{
      if(this.drag){this.clearHold();return;}
      if(this.skills.pickerOpen){this.skills.closePicker();if(this.pickerOnly)this.close();return;}
      this.close();
    };
    this.dialog.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      event.preventDefault();event.stopPropagation();if(!event.repeat)dismiss();
    });
    this.dialog.addEventListener('pointerdown',event=>{
      if(this.skills.pickerOpen && event.target instanceof Node && !this.dialog.querySelector('.skills-picker')!.contains(event.target)
        && !this.bar.contains(event.target)){
        this.skills.closePicker(false);if(this.pickerOnly)this.close();
      }
    });
    bindMenuDismissal(this.dialog, dismiss);
    const dismissOverlays=()=>{
      this.skills.hideTooltip();
      if(this.skills.pickerOpen){this.skills.closePicker();if(this.pickerOnly)this.close();}
    };
    this.dialog.addEventListener('scroll',dismissOverlays,true);
    window.addEventListener('resize',dismissOverlays);
    this.ghost.className='ability-ghost';this.dialog.append(this.ghost);document.getElementById('app')!.append(this.dialog);
    window.addEventListener('pointermove',event=>{if(!this.drag || event.pointerId!==this.drag.pointer)return;if(Math.hypot(event.clientX-this.drag.x,event.clientY-this.drag.y)>5)this.drag.active=true;if(!this.drag.active)return;this.skills.hideTooltip();this.ghost.innerHTML=abilityIcon(this.drag.id);this.ghost.hidden=false;this.ghost.style.left=`${event.clientX}px`;this.ghost.style.top=`${event.clientY}px`;this.buttons.forEach(button=>{const rect=button.getBoundingClientRect();button.classList.toggle('drop-target',event.clientX>=rect.left && event.clientX<=rect.right && event.clientY>=rect.top && event.clientY<=rect.bottom);});});
    window.addEventListener('pointerup',event=>{
      if(event.button!==0)return;
      if(event.pointerId===this.heldPointer){this.held=null;this.heldPointer=null;}
      const drag=this.drag;if(drag && event.pointerId!==drag.pointer)return;this.drag=null;this.ghost.hidden=true;this.buttons.forEach(button=>button.classList.remove('drop-target'));
      if(!drag?.active || !this.ctx.canEdit())return;this.ignoreClickUntil=performance.now()+100;
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-slot]'),bar=[...this.ctx.character().actionBar];
      if(target && this.bar.contains(target)){const slot=Number(target.dataset.slot);if(drag.slot!==undefined)bar[drag.slot]=bar[slot];bar[slot]=drag.id;}
      else if(drag.slot!==undefined)bar[drag.slot]=null;
      if(target && this.bar.contains(target) || drag.slot!==undefined){this.ctx.assign(bar);this.update();}
    });
    window.addEventListener('keyup',event=>{if(event.key===this.heldKey){event.preventDefault();this.held=null;this.heldKey=null;this.ctx.focus();}});
    window.addEventListener('pointercancel',event=>{if(event.pointerId===this.heldPointer || event.pointerId===this.drag?.pointer)this.clearHold();});window.addEventListener('blur',()=>this.clearHold());this.ghost.hidden=true;this.update();
  }
  get paused():boolean{return this.dialog.open;}
  get blocking():boolean{return this.held==='shield-basic';}
  clearHold():void{this.held=null;this.heldPointer=null;this.heldKey=null;this.drag=null;this.ghost.hidden=true;this.buttons.forEach(button=>button.classList.remove('drop-target'));}
  private beginDrag(id:AbilityId,event:PointerEvent):void{
    if(!this.ctx.canEdit() || this.drag && this.drag.pointer!==event.pointerId)return;
    this.skills.closePicker(false);
    this.drag={id,x:event.clientX,y:event.clientY,active:false,pointer:event.pointerId};
    if(event.currentTarget instanceof HTMLElement)event.currentTarget.setPointerCapture(event.pointerId);
  }
  open():void{
    if(this.paused)return;
    this.clearHold();this.ctx.clear();this.pickerOnly=false;this.dialog.append(this.bar);this.skills.prepare();
    this.dialog.showModal();this.update();this.skills.focusSelected();
  }
  close():void{
    this.clearHold();this.skills.hideTooltip();this.skills.closePicker(false);this.dialog.close();
    this.pickerOnly=false;document.getElementById('app')!.append(this.bar);this.ctx.clear();this.ctx.focus();
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
    if(this.paused)this.skills.update();
    this.slots.forEach(({button,icon,cooldown:cooldownValue,key,caption},index)=>{
      const id=character.actionBar[index];
      if(icon.dataset.ability!==(id ?? '')){icon.dataset.ability=id ?? '';icon.innerHTML=id ? hudIcon(id==='sweep' || id==='piercing-shot' ? id : abilities[id].family) : '';
        setText(caption,id ? abilities[id].name : '');}
      const cooldown=id ? state.abilityCooldowns[id] ?? 0 : 0, unavailable=!!id && (abilitySet(state.weaponSets,state.activeSet,id)===undefined || state.playerMana<abilities[id].mana || cooldown>0 || state.player.hp<=0);
      button.classList.toggle('unavailable',!this.paused && unavailable);button.classList.toggle('empty',!id);
      button.dataset.state = !id ? 'empty' : abilitySet(state.weaponSets,state.activeSet,id)===undefined ? 'incompatible' : cooldown>0 ? 'cooldown' : state.playerMana<abilities[id].mana ? 'mana' : 'ready';
      const fill=String(id && abilities[id].cooldown ? cooldown/abilities[id].cooldown : 0);
      if(button.style.getPropertyValue('--cooldown')!==fill)button.style.setProperty('--cooldown',fill);
      setText(cooldownValue,cooldown>0 ? String(Math.ceil(cooldown)) : '');
      setText(key,bindingLabel(preferences[actionSlotInputs[index]].find(Boolean) ?? null));
      const tooltip=id ? this.tooltip(id) : 'Empty';
      setAttribute(button,'title',tooltip);setAttribute(button,'aria-label',id ? tooltip : `Empty slot ${index+1}`);setDisabled(button,this.paused && !this.ctx.canEdit());
    });
    this.utility(this.utilities[0],'potion',character.potions,state.potionCooldown,character.potions===0 || state.player.hp<=0 || state.player.hp>=state.stats.maxHealth || state.potionCooldown>0,'Health Potion');
    this.utility(this.utilities[1],'portal',character.scrolls,0,!this.ctx.portalReady(),'Scroll of Return');
  }
  private utility(elements:UtilityElements,action:'potion'|'portal',count:number,cooldown:number,unavailable:boolean,name:string):void{
    const title=`${name} · ${count}`;
    setText(elements.count,cooldown>0 ? `${Math.ceil(cooldown)}s` : String(count));setText(elements.key,bindingLabel(this.ctx.preferences.value[action].find(Boolean) ?? null));setAttribute(elements.button,'title',title);setAttribute(elements.button,'aria-label',title);setDisabled(elements.button,this.paused || unavailable);
  }
}
