import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { livePreview } from '../../agents/preview.mjs';
import { root } from '../../lib/cli.mjs';
import { evaluate } from '../../levels/common.mjs';
import { reserveGpuMeasurement } from '../../agents/resources.mjs';
/** Queue latency, not frame-rate benchmarking. Decisions and player saves remain untouched. */
export async function measureReview(reason) {
  const reservation = await reserveGpuMeasurement();
  try {
    const state = await livePreview(root); if (!state?.browser || state.lab !== 'assets') throw new Error('Start agent:dev -- --lab assets --browser before measuring asset selection.');
    const samples = await evaluate(state, `(async()=>{const deadline=performance.now()+30000;while(!window.lanternAssetReview?.diagnostics().ready){if(performance.now()>deadline)throw Error('Asset review did not become ready');await new Promise(r=>setTimeout(r,100));}const lab=window.lanternAssetReview;const results=[];for(let i=0;i<4;i++){await new Promise(r=>setTimeout(r,1000));results.push(await lab.next());}return {samples:results,diagnostics:lab.diagnostics(),viewport:[innerWidth,innerHeight],userAgent:navigator.userAgent};})()`, 90000);
    const directory = resolve(root, '.local/level-design/asset-review'); await mkdir(directory, { recursive: true });
    const path = resolve(directory, `selection-${Date.now()}.json`);
    await writeFile(path, JSON.stringify({ reason, kind: 'asset selection latency', conditions: 'Four queue advances after one second of review dwell. Owned native WebGPU preview, no approval decisions.', ...samples }, null, 2) + '\n');
    console.log(`Asset selection evidence: ${path}`); console.log(JSON.stringify(samples.samples));
  } finally { await reservation.release(); }
}
