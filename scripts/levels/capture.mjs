import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli,parseArgs,root } from '../lib/cli.mjs';
import { readState,browser,evaluate,ready,outputDir,command } from './common.mjs';
await cli(async()=>{
  const args=parseArgs(process.argv.slice(2),{'--area':'value'});if(args['--help']){console.log('Usage: npm run levels:capture -- [--area ID]');return;}
  const state=await readState(),start=performance.now(),loaded=await ready(state);const area=args['--area']??loaded.area;
  if((await evaluate(state,'window.lanternAuthoring.diagnostics().area'))!==area)await evaluate(state,`window.lanternAuthoring.selectArea(${JSON.stringify(area)})`);
  await browser(state,['errors','--clear']);
  const initial=await ready(state,area),dir=await outputDir(area,`${initial.runtimeId.slice(0,8)}-${initial.revision}`);const views=await evaluate(state,'window.lanternAuthoring.area().views.map(v=>v.id)');const captures=[];
  try{
    await evaluate(state,'window.lanternAuthoring.freeze(true);window.lanternAuthoring.clean(true)');
    for(const view of [...views,'overview']){
      const started=performance.now();
      await evaluate(state,`window.lanternAuthoring.setView(${JSON.stringify(view)});window.lanternAuthoring.overlays(${view==='overview'});window.lanternAuthoring.settle(16,${initial.revision})`);
      await browser(state,['screenshot',resolve(dir,`view-${view}.png`)]);
      const latest=await ready(state,area);if(latest.revision!==initial.revision||latest.contentHash!==initial.contentHash||latest.runtimeId!==initial.runtimeId)throw new Error('Scene changed during capture');
      captures.push({view,ms:performance.now()-started,diagnostics:latest});
    }
    const errors=await browser(state,['errors']);
    await writeFile(resolve(dir,'manifest.json'),JSON.stringify({status:initial.missing.length?'incomplete':'captured',visualApproval:'requires image inspection',...initial,definition:await evaluate(state,'window.lanternAuthoring.area()'),captures,totalMs:performance.now()-start,browserErrors:errors,viewport:await evaluate(state,'({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,userAgent:navigator.userAgent})')},null,2)+'\n');
    await command('python3',[resolve(root,'scripts/levels/contact-sheet.py'),dir]);console.log(`${initial.missing.length?'INCOMPLETE ART':'Captured'}: ${dir}\nSingle-view times: ${captures.map(c=>`${c.view} ${Math.round(c.ms)}ms`).join(', ')}`);
  }finally{await evaluate(state,'window.lanternAuthoring.clean(false);window.lanternAuthoring.overlays(true)').catch(()=>{});}
});
