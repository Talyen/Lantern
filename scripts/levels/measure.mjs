import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli,parseArgs } from '../lib/cli.mjs';
import { reserveGpuMeasurement } from '../agents/resources.mjs';
import { readAreas,readState,evaluate,ready,outputDir,command } from './common.mjs';
await cli(async()=>{
  const args=parseArgs(process.argv.slice(2),{'--area':'value','--reason':'value'});if(args['--help']){console.log('Usage: npm run levels:measure -- --reason "request or defect evidence" [--area ID]');return;}
  const reason=args['--reason']?.trim();if(!reason)throw new Error('Performance measurement requires --reason with a specific user request or evidenced performance defect.');
  const area=args['--area']??'clearing';if(!(await readAreas())[area])throw new Error(`Unknown area: ${area}`);
  const reservation=await reserveGpuMeasurement();
  try{
  const state=await readState();await ready(state);await evaluate(state,`window.lanternAuthoring.selectArea(${JSON.stringify(area)})`);const initial=await ready(state,area),dir=await outputDir(area,`${initial.runtimeId.slice(0,8)}-${initial.revision}`);
  try{
    const samples=await evaluate(state,`(async()=>{const a=window.lanternAuthoring;a.clean(true);a.overlays(false);a.freeze(false);const canvas=document.querySelector('#scene canvas');const start=performance.now();const bindings=a.diagnostics().controls.bindings;const keys=['moveUp','moveRight','moveDown','moveLeft'].map(action=>bindings[action].find(input=>input?.startsWith('key:'))?.slice(4));if(keys.some(key=>!key))throw new Error('Assign one keyboard input per movement direction before measuring.');let current=keys[0],index=0;canvas.focus();window.dispatchEvent(new KeyboardEvent('keydown',{code:current}));const movement=setInterval(()=>{window.dispatchEvent(new KeyboardEvent('keyup',{code:current}));current=keys[++index%keys.length];window.dispatchEvent(new KeyboardEvent('keydown',{code:current}));},500);try{await new Promise(r=>setTimeout(r,5000));await a.settle(190,${initial.revision});return {graphics:JSON.parse(canvas.dataset.graphics),elapsedMs:performance.now()-start,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},userAgent:navigator.userAgent,phase:a.diagnostics().phase};}finally{clearInterval(movement);window.dispatchEvent(new KeyboardEvent('keyup',{code:current}));a.freeze(true);a.clean(false);a.overlays(true);}})()`,30000);
    const latest=await ready(state,area);if(latest.contentHash!==initial.contentHash||latest.runtimeId!==initial.runtimeId)throw new Error('Scene changed during measurement');
    const gpu=await evaluate(state,`(async()=>{const adapter=await navigator.gpu?.requestAdapter();if(adapter)return {vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description,isFallbackAdapter:adapter.info.isFallbackAdapter};return {status:'WebGPU adapter information unavailable'};})()`);
    const hardware=await command(process.execPath,['-e',"const os=require('node:os');console.log(JSON.stringify({platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,memory:os.totalmem()}))"]);
    await writeFile(resolve(dir,'performance.json'),JSON.stringify({reason,area,revision:initial.revision,contentHash:initial.contentHash,definition:await evaluate(state,'window.lanternAuthoring.area()'),hardware:JSON.parse(hardware),gpu,...samples,conditions:'Keyboard-driven player movement and active combat; headless authoring browser. Presentation cadence, not isolated GPU execution. Confirm GPU acceleration and target hardware separately.'},null,2)+'\n');console.log(`Performance evidence: ${resolve(dir,'performance.json')}`);
  }finally{await evaluate(state,'window.lanternAuthoring.freeze(true);window.lanternAuthoring.clean(false);window.lanternAuthoring.overlays(true)').catch(()=>{});}
  }finally{await reservation.release();}
});
