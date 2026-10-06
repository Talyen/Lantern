import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {cli,parseArgs,root,isMain} from '../lib/cli.mjs';
import {readState} from '../levels/common.mjs';
import {ownedBrowser} from '../agents/browser.mjs';
export const probeOwners=['src/rendering/indirect-lighting.ts','src/rendering/surface-detail.ts','src/rendering/material-calibration.ts','src/rendering/material-recipes.ts','src/rendering/webgpu-pipeline.ts','src/rendering/renderer.ts','src/rendering/native-preparation.ts','src/rendering/stone-surface.ts','src/rendering/woodland-ground.ts','src/rendering/ground-coverage.ts','src/rendering/display-resolution.ts','src/rendering/fsr-temporal.ts','src/rendering/fsr-accumulate.wgsl','src/rendering/fsr-exposure.wgsl','src/labs/materials/probe.ts','src/labs/fsr/exposure-probe.ts','assets/material-recipes.json','package-lock.json'];
export async function probeSignature(){const hash=createHash('sha256');for(const path of probeOwners){hash.update(path);hash.update(await readFile(resolve(root,path)));}return hash.digest('hex');}
if(isMain(import.meta.url))await cli(async()=>{const args=parseArgs(process.argv.slice(2));if(args['--help']){console.log('Usage: npm run materials:probe\nRun the Native GPU material regression probe in an owned authoring preview.');return;}
 const state=await readState(),signature=await probeSignature();
 // Completed-frame probes can outlive one browser command. Keep their result
 // in the owned page so a short RPC deadline cannot discard successful proof.
 const connection=await ownedBrowser(state);
 try {
  await connection.evaluate(`(()=>{const previous=window.lanternMaterialProbe;
   if(!window.lanternAuthoring)throw Error('Open this owned preview in level authoring before running the material probe.');
   if(previous?.signature===${JSON.stringify(signature)}&&(previous.state==='pending'||previous.state==='complete'&&!previous.exported))return;
   if(previous?.state==='pending')throw Error('Material sources changed during an ongoing probe; wait for it to finish.');
   const job={signature:${JSON.stringify(signature)},state:'pending'};window.lanternMaterialProbe=job;
   import('/src/labs/materials/probe.ts').then(m=>m.runMaterialProbe()).then(result=>{job.result=result;job.completed=new Date().toISOString();job.state='complete';},error=>{job.error=String(error);job.state='failed';});
  })()`);
  let completed;
  for (;;) {
   const status=await connection.evaluate('window.lanternMaterialProbe?.state');
   if(status==='complete') { completed=await connection.evaluate('({result:window.lanternMaterialProbe.result,at:window.lanternMaterialProbe.completed})'); break; }
   if(status==='failed')throw Error(await connection.evaluate('window.lanternMaterialProbe.error'));
   if(status!=='pending')throw Error('Owned page changed during the material probe.');
   await delay(250);
  }
 const {result,at}=completed;
 const dir=resolve(root,'.local/level-design/material-probe');await mkdir(dir,{recursive:true});
 for(const [name,png] of Object.entries(result.images))await writeFile(resolve(dir,name+'.png'),Buffer.from(png.split(',')[1],'base64'));
 const report={passed:result.passed,checks:result.checks,fsrExposure:result.fsrExposure,signature,three:'186',completed:at};await writeFile(resolve(dir,'latest.json'),JSON.stringify(report,null,2)+'\n');
 if(signature!==await probeSignature())throw Error('Material sources changed during the probe.');
 await connection.evaluate('window.lanternMaterialProbe.exported=true');
 for(const [name,passed] of Object.entries(result.checks))console.log(`${passed?'PASS':'FAIL'} ${name}`);if(!result.passed)throw Error('Native material regression probe failed.');
 } finally { await connection.close(); }
});
