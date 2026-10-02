export const inputActions = ['slot0','slot1','slot2','slot3','slot4','slot5','moveUp','moveDown','moveLeft','moveRight','dodge','swap','potion','portal','zoomIn','zoomOut','inventory','skills','options'] as const;
export type InputAction = typeof inputActions[number];
export type BindingPair = [string | null,string | null];
export type Bindings = Record<InputAction,BindingPair>;
export const bindingKey='lantern.bindings.v1';
export const inputGroups: {name:string; actions:InputAction[]}[] = [
  {name:'Action Bar',actions:['slot0','slot1','slot2','slot3','slot4','slot5']},
  {name:'Movement',actions:['moveUp','moveDown','moveLeft','moveRight']},
  {name:'Combat & Utility',actions:['dodge','swap','potion','portal']},
  {name:'Camera',actions:['zoomIn','zoomOut']},
  {name:'Menus',actions:['inventory','skills','options']},
];
export const actionNames: Record<InputAction,string> = {slot0:'Slot 1',slot1:'Slot 2',slot2:'Slot 3',slot3:'Slot 4',slot4:'Slot 5',slot5:'Slot 6',moveUp:'Move forward',moveDown:'Move backward',moveLeft:'Move left',moveRight:'Move right',dodge:'Dodge',swap:'Swap weapons',potion:'Use Health Potion',portal:'Use Scroll of Return',zoomIn:'Zoom in',zoomOut:'Zoom out',inventory:'Inventory',skills:'Skills',options:'Options'};
export function defaultBindings(): Bindings {
  return {slot0:['key:KeyQ',null],slot1:['key:KeyE',null],slot2:['key:KeyR',null],slot3:['key:KeyG',null],slot4:['mouse:0',null],slot5:['mouse:2',null],moveUp:['key:KeyW','key:ArrowUp'],moveDown:['key:KeyS','key:ArrowDown'],moveLeft:['key:KeyA','key:ArrowLeft'],moveRight:['key:KeyD','key:ArrowRight'],dodge:['key:ShiftLeft','key:ShiftRight'],swap:['key:Tab',null],potion:['key:KeyF',null],portal:['key:KeyT',null],zoomIn:['wheel:up',null],zoomOut:['wheel:down',null],inventory:['key:KeyB',null],skills:['key:KeyK',null],options:['key:Escape',null]};
}
export function validBinding(value: unknown): value is string | null {
  return value===null || typeof value==='string' && /^(key:(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-9]|2[0-4])|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Meta(Left|Right)|Space|Tab|Escape|Enter|Numpad\w+|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)|mouse:[0-4]|wheel:(up|down))$/.test(value);
}
export function validBindings(value: unknown): value is Bindings {
  if (!value || typeof value!=='object') return false;
  const inputs=new Set<string>();
  return inputActions.filter(action=>action.startsWith('move')).every(action=>Array.isArray((value as Bindings)[action]) && (value as Bindings)[action].some(Boolean)) && inputActions.every(action=> {
    const pair=(value as Bindings)[action];
    return Array.isArray(pair) && pair.length===2 && pair.every(binding=> {
      if (!validBinding(binding)) return false;
      if (binding===null) return true;
      if(binding.startsWith('wheel:') && action!=='zoomIn' && action!=='zoomOut')return false;
      if (inputs.has(binding)) return false;
      inputs.add(binding); return true;
    });
  });
}
export function bindingLabel(binding: string | null): string {
  if (!binding) return '—';
  if (binding.startsWith('mouse:')) return ['LMB','MMB','RMB','Mouse 4','Mouse 5'][Number(binding.slice(6))];
  if (binding.startsWith('wheel:')) return binding==='wheel:up' ? 'Wheel ↑' : 'Wheel ↓';
  const code=binding.slice(4);
  return code.replace(/^Key|^Digit/,'').replace('Arrow','↑↓←→'[['Up','Down','Left','Right'].indexOf(code.slice(5))] ?? 'Arrow').replace(/(Shift|Control|Alt|Meta)(Left|Right)/,(_,key,side)=>`${side==='Left' ? 'L' : 'R'} ${key==='Control' ? 'Ctrl' : key}`).replace('Numpad','Num ');
}
export function inputFor(bindings: Bindings, binding: string): InputAction | undefined { return inputActions.find(action=>bindings[action].includes(binding)); }
export function bindingConflict(bindings: Bindings, binding: string, action: InputAction, index: number): {action:InputAction;index:number} | undefined {
  for (const other of inputActions) for (const [i,value] of bindings[other].entries()) if (value===binding && (other!==action || i!==index)) return {action:other,index:i};
}
type BindingStorage = Pick<Storage,'getItem'|'setItem'>;
export class InputPreferences {
  value = defaultBindings();
  private error = '';
  private pending = false;
  private timer?: ReturnType<typeof setTimeout>;
  private failures = 0;
  constructor(private source?: BindingStorage | (() => BindingStorage)) {
    if (!source) return;
    try { const raw=this.storage()!.getItem(bindingKey); if (!raw) return; const saved=JSON.parse(raw); if (!validBindings(saved)) throw new Error('Invalid bindings'); this.value=saved; }
    catch (error) { this.error=String(error); }
  }
  private storage(): BindingStorage | undefined { return typeof this.source === 'function' ? this.source() : this.source; }
  save(value: Bindings): boolean {
    if (!validBindings(value)) return false;
    this.value=structuredClone(value); this.pending=true;
    if (!this.timer) this.flush();
    return true;
  }
  private flush(closing = false): void {
    if (!this.pending) return;
    try { this.storage()?.setItem(bindingKey,JSON.stringify(this.value)); this.pending=false; this.error=''; this.failures=0; }
    catch (error) {
      this.error=String(error);
      if (!closing) {
        const delays=[1000,2000,5000,15000,30000];
        this.timer=setTimeout(()=>{this.timer=undefined;this.flush();},delays[Math.min(this.failures++,delays.length-1)]);
        if (typeof this.timer === 'object') this.timer.unref();
      }
    }
  }
  close(): void { clearTimeout(this.timer); this.timer=undefined; this.flush(true); }
  diagnostics() { return {pending:this.pending,error:this.error}; }
}

/** Prefer physical codes, accepting code-less keyboard input from browser automation/accessibility tools. */
export function keyboardInput(event: Pick<KeyboardEvent,'code'|'key'|'location'>): string {
  let code=event.code;
  if(!code){
    if(/^[a-z]$/i.test(event.key))code=`Key${event.key.toUpperCase()}`;
    else if(/^[0-9]$/.test(event.key))code=`Digit${event.key}`;
    else if(['Shift','Control','Alt','Meta'].includes(event.key))code=event.key+(event.location===2 ? 'Right' : 'Left');
    else code=event.key===' ' ? 'Space' : event.key;
  }
  return `key:${code}`;
}
