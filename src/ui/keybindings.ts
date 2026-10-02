import { keyboardInput, actionSlotInputs, actionNames, bindingConflict, bindingLabel, defaultBindings, inputActions, inputGroups, validBinding, validBindings, type Bindings, type InputAction, type InputPreferences } from '../input/bindings';
import { abilities, type ActionBar } from '../gameplay/abilities';
import { abilityIcon } from './ability-icons';
import { bindMenuDismissal } from './menu';

type Cell = {action:InputAction;index:number};
export class KeybindingsMenu {
  private dialog=document.createElement('dialog');
  private draft:Bindings=defaultBindings();
  private capture:Cell | null=null;
  private conflict:{cell:Cell;other:Cell;binding:string} | null=null;
  private content=document.createElement('div');
  private status=document.createElement('div');
  private apply=document.createElement('button');
  constructor(private preferences:InputPreferences,private bar:()=>ActionBar,private clear:()=>void,private focus:()=>void) {
    this.dialog.id='keybindings-dialog'; this.dialog.className='combat-menu'; this.dialog.setAttribute('aria-labelledby','keybindings-title');
    this.dialog.innerHTML='<header><h2 id="keybindings-title">Keybindings</h2><button type="button" data-close>Close</button></header><div class="binding-columns"><span>Action</span><span>Primary</span><span>Secondary</span></div>';
    this.content.className='bindings-content'; this.status.className='bindings-status'; this.status.setAttribute('role','status');
    const footer=document.createElement('footer'),reset=document.createElement('button'),cancel=document.createElement('button');
    reset.textContent='Restore defaults';reset.onclick=()=>{this.capture=null;this.conflict=null;this.draft=defaultBindings();this.render();};
    cancel.textContent='Cancel';cancel.onclick=()=>this.close();this.apply.textContent='Apply';this.apply.onclick=()=>this.save();
    footer.append(reset,cancel,this.apply);this.dialog.append(this.content,this.status,footer);document.getElementById('app')!.append(this.dialog);
    this.dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick=()=>this.close();bindMenuDismissal(this.dialog,()=>this.close());
    window.addEventListener('keydown',event=> {
      if (!this.dialog.open || !this.capture) return;
      event.preventDefault();event.stopImmediatePropagation();
      if (event.key==='Escape') {this.capture=null;this.render();return;}
      if (!event.repeat) this.choose(keyboardInput(event));
    },true);
    window.addEventListener('pointerdown',event=> {
      if (!this.dialog.open || !this.capture || (event.target as Element).closest('[data-capture-control]')) return;
      event.preventDefault();event.stopImmediatePropagation();this.choose(`mouse:${event.button}`);
      // Consume the matching click too: it must not open another binding cell.
      if(event.button===0)window.addEventListener('click',click=>{click.preventDefault();click.stopImmediatePropagation();},{capture:true,once:true});
    },true);
    this.dialog.addEventListener('auxclick',event=>event.preventDefault());
    this.dialog.addEventListener('contextmenu',event=>event.preventDefault());
    this.dialog.addEventListener('wheel',event=> {
      if (!this.capture || !event.deltaY) return;
      event.preventDefault();event.stopImmediatePropagation();this.choose(event.deltaY<0 ? 'wheel:up' : 'wheel:down');
    },{passive:false,capture:true});
    window.addEventListener('blur',()=>{if(this.capture){this.capture=null;this.render();}});
  }
  get paused():boolean {return this.dialog.open;}
  open():void {this.clear();this.draft=structuredClone(this.preferences.value);this.capture=null;this.conflict=null;this.render();this.dialog.showModal();}
  close():void {this.capture=null;this.conflict=null;this.dialog.close();this.clear();this.focus();}
  private choose(binding:string):void {
    const cell=this.capture;if(!cell) return;
    if(!validBinding(binding)){this.status.textContent='This input is unavailable.';return;}
    if(binding.startsWith('wheel:') && cell.action!=='zoomIn' && cell.action!=='zoomOut'){this.status.textContent='Wheel inputs are for camera zoom.';return;}
    const other=bindingConflict(this.draft,binding,cell.action,cell.index);this.capture=null;
    if(other) this.conflict={cell,other,binding};else this.draft[cell.action][cell.index]=binding;
    this.render();
  }
  private resolveConflict(swap:boolean):void {
    const conflict=this.conflict;if(!conflict) return;
    this.draft[conflict.other.action][conflict.other.index]=swap ? this.draft[conflict.cell.action][conflict.cell.index] : null;
    this.draft[conflict.cell.action][conflict.cell.index]=conflict.binding;this.conflict=null;this.render();
  }
  private render():void {
    this.content.replaceChildren();this.status.replaceChildren();const bar=this.bar();
    for(const group of inputGroups){
      const section=document.createElement('section'),title=document.createElement('h3');title.textContent=group.name;section.append(title);
      for(const action of group.actions){
        const row=document.createElement('div');row.className='binding-row';const label=document.createElement('span');label.className='binding-action';
        const slot=actionSlotInputs.findIndex(input=>input===action),id=slot>=0 ? bar[slot] : null;
        if(id){const icon=document.createElement('span');icon.className='binding-icon';icon.innerHTML=abilityIcon(id);label.append(icon);}
        const text=document.createElement('span');text.textContent=actionNames[action];label.append(text);
        if(slot>=0){const ability=document.createElement('small');ability.textContent=id ? abilities[id].name : 'Empty';text.append(ability);}
        row.append(label);
        for(const [index,binding] of this.draft[action].entries()){
          const cell=document.createElement('span');cell.className='binding-cell';const button=document.createElement('button');button.type='button';
          button.textContent=this.capture?.action===action && this.capture.index===index ? 'Press an input…' : bindingLabel(binding);
          button.setAttribute('aria-label',`${actionNames[action]}, ${index===0 ? 'Primary' : 'Secondary'}: ${bindingLabel(binding)}`);
          button.classList.toggle('capturing',this.capture?.action===action && this.capture.index===index);
          button.onclick=()=>{this.capture={action,index};this.conflict=null;this.render();};
          const clear=document.createElement('button');clear.type='button';clear.textContent='×';clear.className='clear-binding';clear.setAttribute('aria-label',`Clear ${actionNames[action]} ${index===0 ? 'Primary' : 'Secondary'}`);
          clear.disabled=!binding;clear.onclick=()=>{this.draft[action][index]=null;this.capture=null;this.render();};cell.append(button,clear);row.append(cell);
        }
        section.append(row);
      }
      this.content.append(section);
    }
    const missing=inputActions.filter(action=>action.startsWith('move') && !this.draft[action].some(Boolean));
    this.apply.disabled=!validBindings(this.draft) || !!this.capture || !!this.conflict;
    if(this.capture){
      this.status.textContent='Press a key or mouse button. Escape cancels.';
      for(const [name,callback] of [['Use Escape',()=>this.choose('key:Escape')],['Cancel',()=>{this.capture=null;this.render();}]] as const){const button=document.createElement('button');button.textContent=name;button.dataset.captureControl='true';button.onclick=callback;this.status.append(button);}
    } else if(this.conflict){
      this.status.textContent=`${bindingLabel(this.conflict.binding)} is assigned to ${actionNames[this.conflict.other.action]}.`;
      for(const [name,callback] of [['Swap',()=>this.resolveConflict(true)],['Replace',()=>this.resolveConflict(false)],['Cancel',()=>{this.conflict=null;this.render();}]] as const){const button=document.createElement('button');button.textContent=name;button.onclick=callback;
        const previous=this.draft[this.conflict.cell.action][this.conflict.cell.index];
        button.disabled=name==='Swap' && !!previous?.startsWith('wheel:') && !['zoomIn','zoomOut'].includes(this.conflict.other.action);
        if(button.disabled)button.title='Wheel inputs are for camera zoom.';
        this.status.append(button);}
    }else if(missing.length)this.status.textContent=`Bind ${missing.map(action=>actionNames[action].toLowerCase()).join(', ')} before applying.`;
    else this.status.textContent='';
  }
  private save():void {if(this.apply.disabled)return;this.clear();if(this.preferences.save(this.draft))this.close();else this.render();}
}
