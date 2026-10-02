import {expect,test} from 'vitest';
import {keyboardInput,InputPreferences,bindingConflict,bindingLabel,bindingKey,defaultBindings,inputFor,validBindings} from '../src/input/bindings';

test('a saved mouse movement binding and secondary keyboard binding both resolve to the same action',()=>{
  const data=new Map<string,string>(),storage={getItem:(key:string)=>data.get(key) ?? null,setItem:(key:string,value:string)=>{data.set(key,value);}};
  const preferences=new InputPreferences(storage),draft=defaultBindings();draft.moveUp=['mouse:3','key:KeyI'];draft.slot3=['key:KeyW',null];
  expect(preferences.save(draft)).toBe(true);const restored=new InputPreferences(storage);
  expect(inputFor(restored.value,'mouse:3')).toBe('moveUp');expect(inputFor(restored.value,'key:KeyI')).toBe('moveUp');
  expect([inputFor(restored.value,'key:KeyF'),inputFor(restored.value,'key:KeyT'),bindingLabel(restored.value.slot3[0])]).toEqual(['potion','portal','W']);
});

test('conflicting inputs and missing movement directions cannot replace usable preferences',()=>{
  const preferences=new InputPreferences(),draft=defaultBindings();
  expect(bindingConflict(draft,'key:KeyW','slot0',0)).toEqual({action:'moveUp',index:0});
  draft.slot0[0]='key:KeyW';expect(preferences.save(draft)).toBe(false);expect(preferences.value).toEqual(defaultBindings());
  const missing=defaultBindings();missing.moveUp=[null,null];expect(validBindings(missing)).toBe(false);
  const corrupt=new InputPreferences({getItem:key=>key===bindingKey ? JSON.stringify(missing) : null,setItem:()=>{}});
  expect(corrupt.value).toEqual(defaultBindings());expect(corrupt.error).toMatch('Defaults');
});

test('failed Apply retains the working input profile instead of changing only its in-memory copy',()=>{
  const preferences=new InputPreferences({getItem:()=>null,setItem:()=>{throw Error('storage full');}}),draft=defaultBindings();draft.slot0[0]='key:KeyH';
  expect(preferences.save(draft)).toBe(false);expect(preferences.value.slot0[0]).toBe('key:KeyQ');expect(preferences.error).toMatch('Unable to save');
});

test('code-less held inputs resolve consistently while physical codes take precedence',()=>{expect(keyboardInput({code:'',key:'r',location:0})).toBe('key:KeyR');expect(keyboardInput({code:'KeyW',key:'z',location:0})).toBe('key:KeyW');expect(keyboardInput({code:'',key:'Shift',location:2})).toBe('key:ShiftRight');});
