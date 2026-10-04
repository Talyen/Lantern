import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {cli,parseArgs,root,isMain} from '../lib/cli.mjs';
import {readState,evaluate,browser} from './common.mjs';
import {probeOwners} from '../materials/probe.mjs';
const execute=promisify(execFile);
const subjects=['foliage','smoke','texture'];
async function signature(){const hash=createHash('sha256');for(const path of [...probeOwners,'src/labs/fsr/focused.ts','src/labs/fsr/settings.ts','src/labs/fsr/video.ts','src/rendering/effects.ts']){hash.update(path);hash.update(await readFile(resolve(root,path)));}return hash.digest('hex');}
if(isMain(import.meta.url))await cli(async()=>{
 const args=parseArgs(process.argv.slice(2),{'--subject':'value','--candidate':'boolean','--collect':'boolean','--output':'value'});
 if(args['--help']){console.log('Usage: node scripts/levels/fsr-focused.mjs --subject foliage|smoke|texture [--candidate] [--collect] [--output DIR]\nRequires an owned authoring preview opened with --lab fsr.');return;}
 const subject=args['--subject'];if(!subjects.includes(subject))throw new Error('Select foliage, smoke or texture.');
 const candidate=!!args['--candidate'],id=subject+(candidate?'-after':'-before'),state=await readState(),sourceSignature=await signature();
 const directory=resolve(args['--output']??resolve(root,'.local/level-design/fsr-focused'),id);await mkdir(directory,{recursive:true});
 if(!args['--collect']){
  await browser(state,['set','viewport','1920','1080']);
  if(!await evaluate(state,'!!window.lanternFsrFocused'))await browser(state,['open',state.url+'/?lab=fsr']);
  await evaluate(state,'(async()=>{for(let i=0;i<100;i++){if(window.lanternFsrFocused)return true;await new Promise(r=>setTimeout(r,50));}throw new Error("Focused FSR route is not ready");})()');
  await browser(state,['errors','--clear']);
  await evaluate(state,`(()=>{delete window.fsrFocusedResult;delete window.fsrFocusedError;window.lanternFsrFocused.capture(${JSON.stringify(subject)},${candidate}).then(result=>{window.fsrFocusedResult=result}).catch(error=>{window.fsrFocusedError=String(error)});return true;})()`);
 }
 const deadline=Date.now()+120000;
 for(;;){const status=await evaluate(state,'({ready:!!window.fsrFocusedResult,error:window.fsrFocusedError,status:window.lanternFsrFocused.status()})');if(status.error)throw new Error(status.error);if(status.ready)break;if(Date.now()>deadline)throw new Error('Take is still advancing; collect the existing take with --collect.');await new Promise(r=>setTimeout(r,1000));}
 const result=await evaluate(state,'(()=>{const {images,inputsBefore,inputsAfter,video,...metadata}=window.fsrFocusedResult;return {...metadata,imageNames:Object.keys(images)}})()');
 if(result.subject!==subject||result.candidate!==candidate)throw new Error('Completed take does not match request.');
 for(const name of result.imageNames){const data=await evaluate(state,`window.fsrFocusedResult.images[${JSON.stringify(name)}]`);await writeFile(resolve(directory,name+'.png'),Buffer.from(data.split(',')[1],'base64'));}
 const inputStats={};
 for(const phase of ['Before','After'])for(const name of ['velocity','reactive']){const input=await evaluate(state,`window.fsrFocusedResult.inputs${phase}[${JSON.stringify(name)}]`);await writeFile(resolve(directory,name+'-'+phase.toLowerCase()+'.png'),Buffer.from(input.png.split(',')[1],'base64'));inputStats[name+'-'+phase.toLowerCase()]={mean:input.mean,maximum:input.maximum};}
 const raw=await execute('agent-browser',['--session',state.session,'--headed','false','--json','eval','window.fsrFocusedResult.video'],{cwd:root,timeout:30000,maxBuffer:64*1024*1024}),media=JSON.parse(raw.stdout);if(!media.success||!media.data?.result)throw new Error('Video export failed.');
 await writeFile(resolve(directory,'clip.webm'),Buffer.from(media.data.result.split(',')[1],'base64'));
 if(sourceSignature!==await signature())throw new Error('Sources changed during take.');
 if(candidate){const before=JSON.parse(await readFile(resolve(directory,'../'+subject+'-before/manifest.json'),'utf8'));if(before.sourceSignature!==sourceSignature||JSON.stringify(before.trace)!==JSON.stringify(result.trace))throw new Error('Focused pair has different camera or effect state.');}
 await writeFile(resolve(directory,'manifest.json'),JSON.stringify({...result,inputStats,sourceSignature,browserErrors:await browser(state,['errors']),capturedAt:new Date().toISOString()},null,2)+'\n');
 await evaluate(state,'delete window.fsrFocusedResult');console.log('Captured '+id+': '+directory);
});
