import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {cli,parseArgs,root} from '../lib/cli.mjs';
import {readState,readAreas,evaluate,ready} from './common.mjs';
import {lightingModesFor,lightingProfileOptions} from '../../src/levels/lighting.ts';
await cli(async()=>{
 const args=parseArgs(process.argv.slice(2),{'--area':'value','--lighting':'value','--surfaces':'value','--profile':'value'});
 if(args['--help']){console.log('Usage: npm run lighting:bake -- [--area all|ID] [--lighting all|golden|silver|default] [--surfaces projected|authored] [--profile area|ID]\nUses an existing owned native WebGPU authoring preview. Writes private probe atlases and their source index.');return;}
 const areas=await readAreas(),area=args['--area']??'all',lighting=args['--lighting']??'all',surfaces=args['--surfaces']??'projected',profile=args['--profile']??'area';
 if(area!=='all'&&!areas[area])throw Error('Unknown area: '+area);
 if(!['all','golden','silver','moonlit','dark','misty','default'].includes(lighting)||!['projected','authored'].includes(surfaces))throw Error('Unsupported lighting/surfaces selection');
 if(profile!=='area'&&!lightingProfileOptions().some(p=>p.id===profile))throw Error('Unknown lighting profile: '+profile);
 const state=await readState(),indexPath=resolve(root,'assets/lighting-bakes.json');
 const index=JSON.parse(await readFile(indexPath,'utf8'));
 const output=resolve(root,'public/vendor/lighting');await mkdir(output,{recursive:true});
 const saved=await evaluate(state,'({area:window.lanternAuthoring.area().id,appearance:window.lanternAuthoring.appearance()})');
 let count=0;
 try{
  for(const definition of Object.values(areas).filter(a=>area==='all'||a.id===area)){
   await evaluate(state,`window.lanternAuthoring.selectArea(${JSON.stringify(definition.id)})`);await ready(state,definition.id);
   await evaluate(state,`window.lanternAuthoring.setProfile(${JSON.stringify(profile)})`);
   const supported=lightingModesFor(profile==='area'?definition.lighting:{profile}),modes=lighting==='all'?(supported.length?supported:['default']):[lighting];
   for(const mode of modes){
    if(mode!=='default'&&!supported.includes(mode))throw Error(`${definition.id} does not support ${mode}`);
    await evaluate(state,`window.lanternAuthoring.setSurfaces(${JSON.stringify(surfaces)})`);
    await evaluate(state,`window.lanternAuthoring.setLighting(${JSON.stringify(mode==='default'?'random':mode)})`);await ready(state,definition.id);
    if(!(await evaluate(state,'window.lanternAuthoring.lighting().signature')))continue;
    const data=await evaluate(state,'window.lanternAuthoring.exportLighting()');
    const url=`/vendor/lighting/${data.signature}.json`,path=resolve(root,'public',url.slice(1));
    await writeFile(path+'.partial',JSON.stringify(data));
    await rename(path+'.partial',path);
    for (const [key, previous] of Object.entries(index.bakes)) if (key !== data.signature && previous.area === definition.id && previous.lighting === mode && previous.surfaces === surfaces && (previous.profile??'area') === profile) delete index.bakes[key];
    index.bakes[data.signature]={url,area:definition.id,lighting:mode,surfaces,profile};count++;
    console.log(`Prepared ${definition.id} / ${mode} / ${surfaces}`);
   }
  }
 }finally{
  await evaluate(state,`window.lanternAuthoring.setProfile(${JSON.stringify(saved.appearance.profile??'area')})`).catch(()=>{});
  await evaluate(state,`window.lanternAuthoring.selectArea(${JSON.stringify(saved.area)})`).catch(()=>{});
  await evaluate(state,`window.lanternAuthoring.setSurfaces(${JSON.stringify(saved.appearance.surfaces)})`).catch(()=>{});
  await evaluate(state,`window.lanternAuthoring.setLighting(${JSON.stringify(saved.appearance.forcedLighting??'random')})`).catch(()=>{});
 }
 await writeFile(indexPath,JSON.stringify(index,null,2)+'\n');console.log(`Prepared ${count} probe appearances. Source index: assets/lighting-bakes.json`);
});
