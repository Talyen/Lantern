import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { probeOwners } from '../materials/probe.mjs';
import { cli, parseArgs, root, isMain } from '../lib/cli.mjs';
import { readState, browser, evaluate, ready } from './common.mjs';
const execute = promisify(execFile);
const presets = ['baseline','sharpness-0','sharpness-1','foliage-motion','reactive-coverage','mip-minus-half','mip-minus-one'];
const owners = [...probeOwners,'src/rendering/webgpu-pipeline.ts','src/rendering/effects.ts','src/labs/fsr/settings.ts','src/labs/fsr/comparison.ts','src/labs/fsr/video.ts','src/clearing/clearing.ts','src/levels/authoring.ts','src/clearing/frame-loop.ts','src/rendering/graphics-settings.ts'];
async function signature() { const hash = createHash('sha256'); for (const path of owners) { hash.update(path); hash.update(await readFile(resolve(root,path))); } return hash.digest('hex'); }
if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--preset':'value', '--output':'value', '--collect':'boolean' });
  if (args['--help']) { console.log(`Usage: npm run fsr:compare -- [--preset ${presets.join('|')}] [--output DIR] [--collect]\nCapture a fixed-frame Quality/1080p take in the owned authoring preview. Defaults to baseline; captures remain private.`); return; }
  const preset = args['--preset'] ?? 'baseline'; if (!presets.includes(preset)) throw new Error('Unknown comparison preset.');
  const state = await readState(), sourceSignature = await signature();
  const directory = resolve(args['--output'] ?? resolve(root,'.local/level-design/fsr-comparison'),preset); await mkdir(directory,{recursive:true});
  if (!args['--collect']) {
    await browser(state,['set','viewport','1920','1080']);
    const url = new URL(state.url); url.search = new URLSearchParams({ area:'clearing', author:'levels', fsrCompare:preset, inspection:'render', upscaleQuality:'quality', sharpness:String(preset === 'sharpness-0' ? 0 : preset === 'sharpness-1' ? 1 : .5) }).toString();
    if (await evaluate(state,'!!window.lanternFsrComparison')) await evaluate(state,`window.lanternFsrComparison.select(${JSON.stringify(preset)})`);
    else if (await evaluate(state,'location.href') !== url.href) await browser(state,['open',url.href]);
    await ready(state,'clearing');
    await evaluate(state,'(async()=>{for(let i=0;i<100;i++){if(window.lanternFsrComparison)return true;await new Promise(r=>setTimeout(r,50));}throw new Error("Comparison bridge did not initialize");})()');
    await browser(state,['errors','--clear']);
    // Launch once and poll short evaluations. Long awaited CDP evaluations may
    // be retried by the browser daemon and accidentally start a duplicate take.
    await evaluate(state,'(()=>{delete window.fsrCaptureResult;delete window.fsrCaptureError;window.lanternFsrComparison.capture().then(result=>{window.fsrCaptureResult=result;}).catch(error=>{window.fsrCaptureError=String(error);});return true;})()');
  } else if (await evaluate(state,'window.lanternFsrComparison?.status().preset') !== preset) throw new Error('Live take does not match the requested preset.');
  const deadline = Date.now() + 180000;
  for (;;) {
    const status = await evaluate(state,'({ready:!!window.fsrCaptureResult,error:window.fsrCaptureError,status:window.lanternFsrComparison.status()})');
    if (status.error) throw new Error(status.error);
    if (status.ready) break;
    if (Date.now() > deadline) throw new Error('Capture did not finish; inspect the owned comparison status.');
    await new Promise(resolve => setTimeout(resolve,1000));
  }
  const result = await evaluate(state,'(()=>{const {images,inputsBefore,inputsAfter,video,...metadata}=window.fsrCaptureResult;return {...metadata,imageNames:Object.keys(images),inputNames:Object.keys(inputsBefore)};})()');
  for (const name of result.imageNames) {
    const data = await evaluate(state,`window.fsrCaptureResult.images[${JSON.stringify(name)}]`);
    await writeFile(resolve(directory,`${name}.png`),Buffer.from(data.split(',')[1],'base64'));
  }
  const inputStats = {};
  for (const phase of ['Before','After']) for (const name of result.inputNames) {
    const input = await evaluate(state,`window.fsrCaptureResult.inputs${phase}[${JSON.stringify(name)}]`);
    await writeFile(resolve(directory,`${name}-${phase.toLowerCase()}.png`),Buffer.from(input.png.split(',')[1],'base64')); inputStats[`${name}-${phase.toLowerCase()}`] = { mean:input.mean, maximum:input.maximum };
  }
  // The video alone may exceed the bounded ordinary evaluation buffer.
  const raw = await execute('agent-browser',['--session',state.session,'--headed','false','--json','eval','window.fsrCaptureResult.video'],{cwd:root,timeout:30000,maxBuffer:64*1024*1024});
  const video = JSON.parse(raw.stdout); if (!video.success || !video.data?.result) throw new Error('Video export failed.');
  await writeFile(resolve(directory,'clip.webm'),Buffer.from(video.data.result.split(',')[1],'base64'));
  const browserErrors = await browser(state,['errors']);
  if (sourceSignature !== await signature()) throw new Error('Comparison source changed during capture.');
  if (preset !== 'baseline') {
    const baseline = JSON.parse(await readFile(resolve(directory,'../baseline/manifest.json'),'utf8'));
    if (baseline.sourceSignature !== sourceSignature || baseline.contentHash !== result.contentHash || JSON.stringify(baseline.trace) !== JSON.stringify(result.trace)) throw new Error('Take differs from baseline simulation, effect state, camera or sources.');
  }
  await writeFile(resolve(directory,'manifest.json'),JSON.stringify({...result,inputStats,sourceSignature,sourceRevision:(await execute('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim(),browserErrors,capturedAt:new Date().toISOString()},null,2)+'\n');
  await evaluate(state,'delete window.fsrCaptureResult');
  console.log(`Captured ${preset}: ${directory}\n480 fixed frames; matching state checked against baseline for candidates.`);
});
