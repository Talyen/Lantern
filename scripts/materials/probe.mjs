import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {cli,parseArgs,root,isMain} from '../lib/cli.mjs';
import {readState,evaluate} from '../levels/common.mjs';
export const probeOwners=['src/rendering/indirect-lighting.ts','src/rendering/surface-detail.ts','src/rendering/material-calibration.ts','src/rendering/material-recipes.ts','src/rendering/webgpu-pipeline.ts','src/rendering/renderer.ts','src/rendering/stone-surface.ts','src/rendering/woodland-ground.ts','src/rendering/ground-coverage.ts','src/rendering/display-resolution.ts','src/rendering/fsr-temporal.ts','src/rendering/fsr-accumulate.wgsl','src/labs/materials/probe.ts','assets/material-recipes.json','package-lock.json'];
export async function probeSignature(){const hash=createHash('sha256');for(const path of probeOwners){hash.update(path);hash.update(await readFile(resolve(root,path)));}return hash.digest('hex');}
if(isMain(import.meta.url))await cli(async()=>{const args=parseArgs(process.argv.slice(2));if(args['--help']){console.log('Usage: npm run materials:probe\nRun the Native GPU material regression probe in an owned authoring preview.');return;}
 const state=await readState(),signature=await probeSignature();
 const result=await evaluate(state,'(async()=>{const {runMaterialProbe}=await import("/src/labs/materials/probe.ts");return runMaterialProbe();})()');
 const dir=resolve(root,'.local/level-design/material-probe');await mkdir(dir,{recursive:true});
 for(const [name,png] of Object.entries(result.images))await writeFile(resolve(dir,name+'.png'),Buffer.from(png.split(',')[1],'base64'));
 const report={passed:result.passed,checks:result.checks,signature,three:'186',completed:new Date().toISOString()};await writeFile(resolve(dir,'latest.json'),JSON.stringify(report,null,2)+'\n');
 if(signature!==await probeSignature())throw Error('Material sources changed during the probe.');
 for(const [name,passed] of Object.entries(result.checks))console.log(`${passed?'PASS':'FAIL'} ${name}`);if(!result.passed)throw Error('Native material regression probe failed.');
});
