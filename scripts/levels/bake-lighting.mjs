import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {cli,parseArgs,root} from '../lib/cli.mjs';
import {readState,readAreas,evaluate,ready} from './common.mjs';
await cli(async()=>{
 const args=parseArgs(process.argv.slice(2),{'--area':'value','--surfaces':'value'});
 if(args['--help']){console.log('Usage: npm run lighting:bake -- [--area all|ID] [--surfaces projected|authored]\nPrepares the shared Golden preset in an existing owned native WebGPU authoring preview. Writes private probe atlases and their source index.');return;}
 const areas=await readAreas(),area=args['--area']??'all',surfaces=args['--surfaces']??'projected';
 if(area!=='all'&&!areas[area])throw Error('Unknown area: '+area);
 if(!['projected','authored'].includes(surfaces))throw Error('Unsupported surfaces selection');
 const state=await readState(),indexPath=resolve(root,'assets/lighting-bakes.json');
 const index=JSON.parse(await readFile(indexPath,'utf8'));
 const output=resolve(root,'public/vendor/lighting');await mkdir(output,{recursive:true});
 const saved=await evaluate(state,'({area:window.lanternAuthoring.area().id,appearance:window.lanternAuthoring.appearance()})');
 let count=0;
 try{
  for(const definition of Object.values(areas).filter(a=>area==='all'||a.id===area)){
   await evaluate(state,`window.lanternAuthoring.selectArea(${JSON.stringify(definition.id)})`);await ready(state,definition.id);
   await evaluate(state,`window.lanternAuthoring.setSurfaces(${JSON.stringify(surfaces)})`);await ready(state,definition.id);
   if(!(await evaluate(state,'window.lanternAuthoring.lighting().signature')))continue;
   const data=await evaluate(state,'window.lanternAuthoring.exportLighting()');
   const url=`/vendor/lighting/${data.signature}.json`,path=resolve(root,'public',url.slice(1));
   await writeFile(path+'.partial',JSON.stringify(data));
   await rename(path+'.partial',path);
   for (const [key, previous] of Object.entries(index.bakes)) if (key !== data.signature && previous.area === definition.id && previous.surfaces === surfaces) delete index.bakes[key];
   index.bakes[data.signature]={url,area:definition.id,surfaces};count++;
   console.log(`Prepared ${definition.id} / Golden / ${surfaces}`);
  }
 }finally{
  await evaluate(state,`window.lanternAuthoring.selectArea(${JSON.stringify(saved.area)})`).catch(()=>{});
  await evaluate(state,`window.lanternAuthoring.setSurfaces(${JSON.stringify(saved.appearance.surfaces)})`).catch(()=>{});
 }
 await writeFile(indexPath,JSON.stringify(index,null,2)+'\n');console.log(`Prepared ${count} probe appearances. Source index: assets/lighting-bakes.json`);
});
