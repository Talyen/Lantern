/** Own one isolated headless browser and Vite server; capture via the shared WebGPU gallery. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, parseArgs, root, run, integer, UsageError } from '../../lib/cli.mjs';
import { livePreview, startPreview, stopPreview } from '../../agents/preview.mjs';
import { browser } from '../../levels/common.mjs';
import { ownedBrowser } from '../../agents/browser.mjs';
import { captureScreenshot, pngSize } from '../../agents/capture.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--limit': 'value', '--motions': 'boolean', '--family': 'value', '--character': 'value', '--all': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run characters:capture -- --character ID | --all [--limit N] [--motions] [--family NAME]\nExports roster thumbnails/contact sheets; --motions also captures idle/run/attack review sheets.'); return; }
  if (args['--limit']) integer(args['--limit'], 1, 1, Number.MAX_SAFE_INTEGER, 'Limit');
  if (!!args['--character'] === !!args['--all']) throw new UsageError('Choose one --character ID or explicitly request --all.');
  const directory = resolve(root, '.local/character-gallery');
  const vendor = resolve(root, 'public/vendor/character-gallery');
  await mkdir(directory, { recursive: true }); await mkdir(resolve(vendor, 'thumbnails'), { recursive: true });
  const catalog = JSON.parse(await readFile(resolve(vendor, 'catalog.json'), 'utf8'));
  if (!catalog.complete && args['--all'] && !args['--limit']) throw new Error('Finish character exports before capturing the complete roster.');
  if (args['--family'] && !catalog.characters.some(row => row.family === args['--family'])) throw new UsageError('Unknown character family');
  if (args['--character'] && !catalog.characters.some(row => row.id === args['--character'])) throw new UsageError('Unknown character ID');
  const previous = await readFile(resolve(directory, 'captures.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const existing = await livePreview(root);
  const state = await startPreview(root, { browser: true, lab: 'characters' });
  const captures = [];
  let connection;
  try {
    connection = await ownedBrowser(state);
    const evaluate = expression => connection.evaluate(expression);
    await evaluate(`(async()=>{for(let i=0;i<300;i++){if(window.lanternCharacters)return true;const e=document.querySelector('[data-render-error]');if(e)throw new Error(e.dataset.renderError);await new Promise(r=>setTimeout(r,50));}throw new Error('Gallery startup failed');})()`);
    await browser(state, ['snapshot', '-i']);
    await captureScreenshot(connection, resolve(directory, 'gallery-startup.png'), { overwrite: true });
    // Gut check the real route before starting the batch.
    if (await evaluate(`!!document.querySelector('vite-error-overlay')`) || !(await evaluate(`document.title.includes('Characters')`))) throw new Error('Gallery browser verification failed');
    const takeCharacter = async (id, role = 'static', seconds = 0) => {
      const { image, graphics } = await evaluate(`(async()=>{const image=await window.lanternCharacters.capture(${JSON.stringify(id)},${JSON.stringify(role)},${seconds});return {image,graphics:window.lanternCharacters.captureEvidence()};})()`);
      const pixels = Buffer.from(image.split(',')[1], 'base64');
      const size = pngSize(pixels), view = graphics?.views[0];
      if (!view?.ready || size.width !== view.outputWidth || size.height !== view.outputHeight) throw new Error('Character image does not match its render evidence.');
      return { pixels, graphics };
    };
    for (const row of catalog.characters.filter(row => (!args['--family'] || row.family === args['--family']) && (!args['--character'] || row.id === args['--character'])).slice(0, Number(args['--limit']) || catalog.characters.length)) {
      const { pixels, graphics } = await takeCharacter(row.id);
      const file = resolve(vendor, 'thumbnails', `${row.id}.png`);
      await writeFile(file, pixels);
      row.thumbnail = `/vendor/character-gallery/thumbnails/${row.id}.png`;
      const capture = { id: row.id, name: row.name, family: row.family, image: file, motions: {}, motionGraphics: {}, graphics, diagnostics: await evaluate('window.lanternCharacters.diagnostics()[0]') };
      if (args['--motions']) for (const [role, motion] of Object.entries(row.motions)) {
        const { pixels, graphics } = await takeCharacter(row.id, role, motion.duration * 0.45);
        const file = resolve(directory, `${row.id}-${role}.png`); await writeFile(file, pixels); capture.motions[role] = file; capture.motionGraphics[role] = graphics;
      }
      captures.push(capture); console.log(`Captured ${captures.length}: ${row.family} / ${row.name}`);
    }
    const errors = await browser(state, ['errors']); if (errors.trim()) throw new Error(`Browser errors: ${errors}`);
    await writeFile(resolve(vendor, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
    const merged = new Map((previous?.captures ?? []).map(row => [row.id, row]));
    captures.forEach(row => merged.set(row.id, row));
    const records = catalog.characters.flatMap(row => merged.has(row.id) ? [merged.get(row.id)] : []);
    await writeFile(resolve(directory, 'captures.json'), JSON.stringify({ expectedCount: catalog.expectedCount, captures: records, browserErrors: errors }, null, 2) + '\n');
    if (args['--all']) await run('python3', [resolve(root, 'scripts/assets/characters/contact-sheet.py'), directory]);
    console.log(`Character contact sheets: ${directory}`);
  } finally { await connection?.close(); if (!existing) await stopPreview(root); }
});
