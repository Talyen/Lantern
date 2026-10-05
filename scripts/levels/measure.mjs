import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, parseArgs, UsageError, root } from '../lib/cli.mjs';
import { context, liveLeases } from '../agents/state.mjs';
import { reserveGpuMeasurement } from '../agents/resources.mjs';
import { readAreas, readState, outputDir, command } from './common.mjs';
import { measurementBrowser } from './measurement-browser.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--area': 'value', '--reason': 'value', '--lab': 'value', '--quick': 'boolean', '--dpr': 'value', '--viewport': 'value' });
  if (args['--help']) { console.log('Usage: npm run levels:measure -- --reason "request or defect evidence" [--area ID | --lab assets] [--quick] [--viewport WIDTHxHEIGHT --dpr RATIO]\nQuick: 0.5 s warmup + 2 s sampling. Default: 5 s warmup + up to 10 s / 180 intervals. Reuses the current area.'); return; }
  const reason = args['--reason']?.trim(); if (!reason) throw new UsageError('Performance measurement requires --reason with a specific user request or evidenced performance defect.');
  if (args['--lab']) {
    if (args['--lab'] !== 'assets' || args['--area'] || args['--quick'] || args['--viewport'] || args['--dpr']) throw new UsageError('Use --lab assets without level profiling options.');
    const { measureReview } = await import('../assets/review/measure.mjs'); await measureReview(reason); return;
  }
  const area = args['--area'] ?? 'clearing'; if (!(await readAreas())[area]) throw new UsageError(`Unknown area: ${area}`);
  const viewport = args['--viewport']?.match(/^(\d+)x(\d+)$/)?.slice(1).map(Number);
  if (args['--viewport'] && (!viewport || viewport.some(n => n < 320 || n > 7680))) throw new UsageError('--viewport must be WIDTHxHEIGHT, 320–7680 per axis');
  const dpr = args['--dpr'] ? Number(args['--dpr']) : undefined;
  if (dpr !== undefined && (!Number.isFinite(dpr) || dpr < .5 || dpr > 4)) throw new UsageError('--dpr must be between 0.5 and 4');
  const reservation = await reserveGpuMeasurement(); let connection;
  try {
    connection = await measurementBrowser(await readState());
    const evaluate = expression => connection.evaluate(expression);
    const originalViewport = await evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
    try {
      if (viewport || dpr) await connection.viewport(viewport?.[0] ?? originalViewport.width, viewport?.[1] ?? originalViewport.height, dpr ?? originalViewport.dpr);
      const initial = await evaluate(`(async()=>{const bridgeDeadline=performance.now()+20000;while(!window.lanternAuthoring&&performance.now()<bridgeDeadline)await new Promise(r=>setTimeout(r,50));const a=window.lanternAuthoring;if(!a)throw Error('Owned authoring bridge unavailable after readiness deadline');if(a.diagnostics().area!==${JSON.stringify(area)})await a.selectArea(${JSON.stringify(area)});const deadline=performance.now()+20000;while(performance.now()<deadline){const d=a.diagnostics();if(d.errors.length)throw Error(d.errors.join('\\n'));if(d.ready&&d.area===${JSON.stringify(area)})return d;await new Promise(r=>setTimeout(r,50));}throw Error('Scene readiness timed out');})()`);
      const resources = await context(root);
      const heavyBefore = (await liveLeases(resources)).filter(lease => lease.resource === 'heavy');
      const quick = !!args['--quick'], warmupMs = quick ? 500 : 5000, sampleMs = quick ? 2000 : 10000;
      const samples = await evaluate(`(async()=>{
        const a=window.lanternAuthoring,canvas=document.querySelector('#scene canvas');
        a.clean(true);a.overlays(false);a.freeze(false);canvas.focus();
        const bindings=a.diagnostics().controls.bindings,keys=['moveUp','moveRight','moveDown','moveLeft'].map(action=>bindings[action].find(input=>input?.startsWith('key:'))?.slice(4));
        if(keys.some(key=>!key))throw Error('Assign keyboard movement bindings before measuring.');
        let current=keys[0],index=0;window.dispatchEvent(new KeyboardEvent('keydown',{code:current}));
        const movement=setInterval(()=>{window.dispatchEvent(new KeyboardEvent('keyup',{code:current}));current=keys[++index%keys.length];window.dispatchEvent(new KeyboardEvent('keydown',{code:current}));},500);
        try {
          const start=performance.now();await new Promise(r=>setTimeout(r,${warmupMs}));
          a.resetMeasurements();const sampleStart=performance.now(),frames=a.diagnostics().renderedFrames;
          const viewport={width:innerWidth,height:innerHeight,dpr:devicePixelRatio};
          const conditions={visibility:document.visibilityState,focused:document.hasFocus()};
          if(${quick})await new Promise(r=>setTimeout(r,${sampleMs}));
          else while(performance.now()-sampleStart<${sampleMs}&&a.measurements().samples.length<180)await new Promise(r=>setTimeout(r,25));
          const d=a.diagnostics(),graphics=a.measurements();
          if(d.runtimeId!==${JSON.stringify(initial.runtimeId)}||d.revision!==${initial.revision}||d.contentHash!==${JSON.stringify(initial.contentHash)}||d.errors.length)throw Error('Scene changed or failed during measurement');
          return {graphics,definition:a.area(),elapsedMs:performance.now()-start,sampleElapsedMs:performance.now()-sampleStart,completedFrames:d.renderedFrames-frames,viewport,endViewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},conditions,endConditions:{visibility:document.visibilityState,focused:document.hasFocus()},userAgent:navigator.userAgent,phase:d.phase,ready:d.ready};
        } finally {clearInterval(movement);window.dispatchEvent(new KeyboardEvent('keyup',{code:current}));a.freeze(true);a.clean(false);a.overlays(true);}
      })()`);
      const heavyAfter = (await liveLeases(resources)).filter(lease => lease.resource === 'heavy');
      const gpu = await evaluate(`(async()=>{const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {status:'WebGPU adapter information unavailable'};return {...adapter.info.toJSON?.(),vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description,isFallbackAdapter:adapter.info.isFallbackAdapter};})()`);
      const hardware = JSON.parse(await command(process.execPath, ['-e', "const os=require('node:os');console.log(JSON.stringify({platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,memory:os.totalmem()}))"]));
      const sourceCommit = (await command('git', ['rev-parse', 'HEAD'])).trim();
      const sourceHash = createHash('sha256').update(await command('git', ['diff', 'HEAD', '--', 'src', 'assets', 'vite.config.ts', 'package-lock.json']));
      const added = (await command('git', ['ls-files', '--others', '--exclude-standard', '--', 'src', 'assets'])).trim().split('\n').filter(Boolean).sort();
      for (const path of added) sourceHash.update(path).update(await readFile(resolve(root, path)));
      const sourceDiffHash = sourceHash.digest('hex');
      const intervals = samples.graphics.samples, mean = intervals.reduce((sum, n) => sum + n, 0) / Math.max(1, intervals.length);
      const issues = [];
      if (heavyBefore.length || heavyAfter.length) issues.push('concurrent heavy work');
      if (intervals.length < (quick ? 30 : 180)) issues.push('insufficient samples');
      if (JSON.stringify(samples.viewport) !== JSON.stringify(samples.endViewport)) issues.push('viewport changed');
      if (samples.conditions.visibility !== 'visible' || samples.endConditions.visibility !== 'visible') issues.push('hidden page');
      if (!samples.conditions.focused || !samples.endConditions.focused) issues.push('unfocused page');
      if (!samples.graphics.pipeline.ready || !samples.ready) issues.push('scene or pipeline not ready');
      const report = { reason, mode: quick ? 'quick' : 'acceptance', warmupMs, sampleLimitMs: sampleMs, area, revision: initial.revision, contentHash: initial.contentHash, sourceCommit, sourceDiffHash, competingResources: { heavyBefore, heavyAfter }, hardware, gpu, ...samples, sampleCount: intervals.length, meanMs: intervals.length ? mean : null, meanFps: intervals.length ? 1000 / mean : null, worstFrameMs: intervals.length ? Math.max(...intervals) : null, stallsOver50Ms: intervals.filter(n => n > 50).length, standardDeviationMs: intervals.length ? Math.sqrt(intervals.reduce((sum, n) => sum + (n - mean) ** 2, 0) / intervals.length) : null, status: issues.length ? 'inconclusive' : 'valid', issues, measurement: 'Keyboard movement in the owned development browser. Presentation cadence and CPU submission, not whole-frame GPU execution. DPR overrides are emulation; verify target Safari separately.' };
      const dir = await outputDir(area, `${initial.runtimeId.slice(0, 8)}-${initial.revision}`), path = resolve(dir, quick ? 'performance-quick.json' : 'performance.json');
      await writeFile(path, JSON.stringify(report, null, 2) + '\n');
      console.log(`${report.mode}: ${report.status}; ${report.sampleCount} samples / ${(report.sampleElapsedMs / 1000).toFixed(2)} s; median ${report.graphics.median?.toFixed(1) ?? 'n/a'} ms, p95 ${report.graphics.p95?.toFixed(1) ?? 'n/a'} ms; mean ${report.meanFps?.toFixed(1) ?? 'n/a'} fps, worst ${report.worstFrameMs?.toFixed(1) ?? 'n/a'} ms; ${report.graphics.width}×${report.graphics.height} output, DPR ${report.viewport.dpr}, FSR ${report.graphics.settings.upscaleQuality}${issues.length ? '; ' + issues.join(', ') : ''}\nPerformance evidence: ${path}`);
    } finally {
      await connection.evaluate('window.lanternAuthoring?.freeze(true);window.lanternAuthoring?.clean(false);window.lanternAuthoring?.overlays(true)').catch(() => {});
      if (viewport || dpr) await connection.viewport(originalViewport.width, originalViewport.height, originalViewport.dpr).catch(() => {});
    }
  } finally { try { if (connection) await connection.close(); } finally { await reservation.release(); } }
});
