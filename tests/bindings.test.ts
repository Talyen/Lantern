import {expect,test,vi} from 'vitest';
import {keyboardInput,InputPreferences,bindingConflict,bindingKey,defaultBindings,inputActions,inputFor,validBindings} from '../src/input/bindings';

test('conflicting inputs and missing movement directions cannot replace usable preferences',()=>{
  const preferences=new InputPreferences(),draft=defaultBindings();
  expect(bindingConflict(draft,'key:KeyW','slot0',0)).toEqual({action:'moveUp',index:0});
  draft.slot0[0]='key:KeyW';expect(preferences.save(draft)).toBe(false);expect(preferences.value).toEqual(defaultBindings());
  const missing=defaultBindings();missing.moveUp=[null,null];expect(validBindings(missing)).toBe(false);
  const corrupt=new InputPreferences({getItem:key=>key===bindingKey ? JSON.stringify(missing) : null,setItem:()=>{}});
  expect(corrupt.value).toEqual(defaultBindings());expect(corrupt.diagnostics().error).toMatch('Invalid bindings');
});

// Admission: fallback keys must survive validation, save/restore and action dispatch, not only string conversion.
test('physical and code-less captured keys remain usable after saving and reopening bindings', () => {
  const keys = [
    ['', 'i', 0, 'KeyI'], ['KeyI', 'z', 0, 'KeyI'], ['', 'Shift', 2, 'ShiftRight'],
    ['', '.', 0, 'Period'], ['', '?', 0, 'Slash'], ['', '1', 3, 'Numpad1'], ['', 'Enter', 3, 'NumpadEnter'], ['', 'End', 0, 'End'],
    ...Array.from(')!@#$%^&*(', (key, digit) => ['', key, 0, `Digit${digit}`] as const),
    ...[['End','1'],['ArrowDown','2'],['PageDown','3'],['ArrowLeft','4'],['Clear','5'],['ArrowRight','6'],['Home','7'],['ArrowUp','8'],['PageUp','9'],['Insert','0'],['Delete','Decimal']].map(([key, digit]) => ['', key, 3, `Numpad${digit}`] as const),
  ] as const;
  let saved = '';
  const storage = { getItem: () => saved || null, setItem: (_key: string, value: string) => { saved = value; } };
  for (const [code, key, location, expected] of keys) {
    const captured = keyboardInput({ code, key, location }), draft = defaultBindings();
    for (const action of inputActions) draft[action] = draft[action].map(value => value === captured ? null : value) as [string | null, string | null];
    draft.slot0 = [captured, null];
    const preferences = new InputPreferences(storage);
    expect(preferences.save(draft)).toBe(true);
    expect(inputFor(new InputPreferences(storage).value, `key:${expected}`)).toBe('slot0');
    preferences.close();
  }
});

test('keybinding changes apply immediately and retry storage silently without keeping Apply open',async()=>{
  vi.useFakeTimers();
  try {
    let failing=true, saved='';
    const preferences=new InputPreferences({getItem:()=>null,setItem:(_key,value)=>{if(failing)throw Error('full');saved=value;}});
    const draft=defaultBindings();draft.moveUp=['mouse:3','key:KeyI'];draft.slot3=['key:KeyW',null];
    expect(preferences.save(draft)).toBe(true);expect(preferences.value).toEqual(draft);expect(preferences.diagnostics().pending).toBe(true);
    const latest=structuredClone(draft);latest.slot0=['key:KeyU',null];preferences.save(latest);
    failing=false;await vi.advanceTimersByTimeAsync(1000);expect(JSON.parse(saved)).toEqual(latest);expect(inputFor(new InputPreferences({getItem:()=>saved,setItem:()=>{}}).value,'key:KeyU')).toBe('slot0');
    expect(inputFor(preferences.value,'mouse:3')).toBe('moveUp');expect(inputFor(preferences.value,'key:KeyI')).toBe('moveUp');expect(preferences.diagnostics().pending).toBe(false);
    preferences.close();expect(vi.getTimerCount()).toBe(0);
  } finally {vi.useRealTimers();}
});
