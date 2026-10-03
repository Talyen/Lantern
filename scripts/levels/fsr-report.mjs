import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, parseArgs, root, isMain } from '../lib/cli.mjs';
const presets = ['sharpness-0', 'baseline', 'sharpness-1'];
if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--directory': 'value' });
  if (args['--help']) { console.log('Usage: node scripts/levels/fsr-report.mjs [--directory DIR]\nBuild a simple sharpness preview from the matched 0.00, 0.50 and 1.00 captures.'); return; }
  const directory = resolve(args['--directory'] ?? resolve(root, '.local/level-design/fsr-comparison'));
  const manifests = await Promise.all(presets.map(async preset => JSON.parse(await readFile(resolve(directory, preset, 'manifest.json'), 'utf8'))));
  const baseline = manifests[1];
  for (const take of manifests) if (take.sourceSignature !== baseline.sourceSignature || take.contentHash !== baseline.contentHash || JSON.stringify(take.trace) !== JSON.stringify(baseline.trace)) throw new Error('Preview requires matched takes.');
  // Keep the visually clear choice in front of the reader. Other experiments
  // remain in the private capture directory, without cluttering this preview.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Lantern · Sharpness</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#15191e;color:#ede8df;font:16px system-ui}main{max-width:988px;height:100svh;min-height:440px;margin:0 auto;padding:20px 24px;display:flex;flex-direction:column;gap:12px}h1{font-size:26px;margin:0}p{line-height:1.4;color:#c8c4bc;margin:0}.choices{display:flex;gap:8px}button{flex:1;min-height:44px;background:#252c34;border:1px solid #636b72;border-radius:7px;color:inherit;font:inherit;cursor:pointer}button[aria-pressed=true]{background:#826638;border-color:#e7c47d;color:#fff}button:focus-visible{outline:3px solid #edcc8b;outline-offset:3px}button:disabled{cursor:wait;opacity:.6}figure{margin:0;flex:1;min-height:120px;overflow:hidden}canvas{display:block;width:100%;height:100%;object-fit:contain}.caption{display:block;min-height:23px;line-height:1.4}.note{font-size:12px;color:#aaa59a}.quiet{border-top:1px solid #353d45;padding-top:8px;font-size:13px;color:#aaa59a}@media(max-width:550px){main{padding:16px;gap:10px}h1{font-size:22px}button{font-size:14px}.caption{font-size:14px}}
</style></head>
<body><main>
<h1>Sharpness comparison</h1>
<p>Switch between the three settings. Look at the helmet edge, axe blade and grain in the ground.</p>
<div class="choices" aria-label="Sharpening setting"><button data-preset="sharpness-0" aria-pressed="false" disabled>Soft · 0.00</button><button data-preset="baseline" aria-pressed="true" disabled>Current · 0.50</button><button data-preset="sharpness-1" aria-pressed="false" disabled>Crisp · 1.00</button></div>
<figure><canvas id="detail" width="470" height="300" role="img" aria-label="Matched character and ground close-ups"></canvas></figure><p id="caption" class="caption" aria-live="polite">Loading captured detail…</p>
<p class="note">Same frame and position. Close-up only; the captured image is unchanged.</p>
<p class="quiet">The other tweaks looked too similar in these samples to include here.</p>
</main><script>
const options=[{preset:'sharpness-0',caption:'Softer edges and smoother-looking ground.'},{preset:'baseline',caption:'Current setting: a middle ground between soft and crisp.'},{preset:'sharpness-1',caption:'More pronounced edges and stronger texture grain.'}];
const canvas=document.getElementById('detail'),ctx=canvas.getContext('2d'),caption=document.getElementById('caption'),buttons=[...document.querySelectorAll('[data-preset]')],images=new Map();
function show(preset){const option=options.find(value=>value.preset===preset),image=images.get(preset);ctx.fillStyle='#15191e';ctx.fillRect(0,0,470,300);ctx.fillStyle='#c8c4bc';ctx.font='14px system-ui';ctx.fillText('Helmet & axe',0,18);ctx.fillText('Ground texture',200,18);ctx.drawImage(image,790,405,180,270,0,30,180,270);ctx.drawImage(image,360,530,270,270,200,30,270,270);buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.preset===preset)));canvas.setAttribute('aria-label',option.caption+' Matched character and ground close-ups.');caption.textContent=option.caption;}
Promise.all(options.map(option=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images.set(option.preset,image);resolve()};image.onerror=()=>reject(new Error('The captured images could not be loaded. Keep this page beside its sample folders.'));image.src=option.preset+'/still.png'}))).then(()=>{buttons.forEach(button=>{button.disabled=false;button.onclick=()=>show(button.dataset.preset)});show('baseline')}).catch(error=>{caption.textContent=error.message});
</script></body></html>`;
  await writeFile(resolve(directory, 'index.html'), html); console.log(`Sharpness preview: ${resolve(directory, 'index.html')}`);
});
