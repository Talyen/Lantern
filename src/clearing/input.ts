import { keyboardInput, inputFor, type InputAction, type InputPreferences } from '../input/bindings';

/** Physical inputs belong here; gameplay receives actions and held states, never key names. */
export function createInput(canvas: HTMLCanvasElement, preferences: InputPreferences, onAction: (action:InputAction)=>void,
  onWorldClick: (x:number,y:number)=>boolean, onClear:()=>void = ()=>{}) {
  const down=new Set<string>();
  let pointer:{x:number;y:number} | undefined;
  const clear=()=> { down.clear(); pointer=undefined; onClear(); };
  const trackPointer=(event:PointerEvent)=> {
    const rect=canvas.getBoundingClientRect();
    if (event.pointerType!=='mouse' && event.pointerType!=='pen') return;
    pointer=event.clientX>=rect.left && event.clientX<rect.right && event.clientY>=rect.top && event.clientY<rect.bottom ? {x:event.clientX,y:event.clientY} : undefined;
  };
  const menus=new Set<InputAction>(['inventory','skills','options']);
  const dispatch=(binding:string,repeat=false)=> {
    const action=inputFor(preferences.value,binding);
    if (action && (!repeat || action==='zoomIn' || action==='zoomOut')) onAction(action);
    return action;
  };
  canvas.addEventListener('pointermove',event=> { if (!document.querySelector('dialog[open]')) trackPointer(event); });
  canvas.addEventListener('pointerleave',()=> { pointer=undefined; });
  canvas.addEventListener('pointercancel',clear);
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  canvas.addEventListener('auxclick',event=>event.preventDefault());
  canvas.addEventListener('pointerdown',event=> {
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault(); canvas.focus(); trackPointer(event);
    // World selection always consumes a left click before its assigned combat action.
    if (event.button===0 && onWorldClick(event.clientX,event.clientY)) return;
    const binding=`mouse:${event.button}`; down.add(binding); dispatch(binding);
  });
  window.addEventListener('pointerup',event=>down.delete(`mouse:${event.button}`));
  window.addEventListener('keydown',event=> {
    if (event.defaultPrevented || event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable=true]')) return;
    const binding=keyboardInput(event), action=inputFor(preferences.value,binding);
    if (!action) return;
    if(menus.has(action)){event.preventDefault();if(!event.repeat)onAction(action);return;}
    if(document.querySelector('dialog[open]'))return;
    if (event.target instanceof HTMLElement && event.target.closest('select,button,summary,a')) return;
    event.preventDefault(); down.add(binding); dispatch(binding,event.repeat);
  });
  window.addEventListener('keyup',event=>down.delete(keyboardInput(event)));
  window.addEventListener('blur',clear);
  canvas.addEventListener('wheel',event=> { if (document.querySelector('dialog[open]') || event.deltaY===0) return; event.preventDefault(); dispatch(event.deltaY<0 ? 'wheel:up' : 'wheel:down'); },{passive:false});
  const held=(action:InputAction)=>preferences.value[action].some(binding=>binding!==null && down.has(binding));
  return {clear,pointer:()=>pointer,held,suppress:(action:InputAction)=>preferences.value[action].forEach(binding=>{if(binding) down.delete(binding);}),
    movement:()=> { const forward=Number(held('moveUp'))-Number(held('moveDown')),right=Number(held('moveRight'))-Number(held('moveLeft')); return {x:-forward+right,z:-forward-right}; },
  };
}
