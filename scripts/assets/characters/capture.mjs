/** Own one isolated headless browser and Vite server; capture via the shared WebGPU gallery. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, parseArgs, root, run, integer, UsageError } from '../../lib/cli.mjs';
import { livePreview, startPreview, stopPreview } from '../../agents/preview.mjs';
import { browser, evaluate } from '../../levels/common.mjs';
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
  try {
    await browser(state, ['set', 'viewport', '1200', '900']);
    await evaluate(state, `(async()=>{for(let i=0;i<300;i++){if(window.lanternCharacters)return true;const e=document.querySelector('[data-render-error]');if(e)throw new Error(e.dataset.renderError);await new Promise(r=>setTimeout(r,50));}throw new Error('Gallery startup failed');})()`);
    await browser(state, ['snapshot', '-i']);
    await browser(state, ['screenshot', 'body', resolve(directory, 'gallery-startup.png')]);
    // Gut check the real route before starting the batch.
    if (await evaluate(state, `!!document.querySelector('vite-error-overlay')`) || !(await evaluate(state, `document.title.includes('Characters')`))) throw new Error('Gallery browser verification failed');
    for (const row of catalog.characters.filter(row => (!args['--family'] || row.family === args['--family']) && (!args['--character'] || row.id === args['--character'])).slice(0, Number(args['--limit']) || catalog.characters.length)) {
      const image = await evaluate(state, `window.lanternCharacters.capture(${JSON.stringify(row.id)})`);
      const file = resolve(vendor, 'thumbnails', `${row.id}.png`);
      await writeFile(file, Buffer.from(image.split(',')[1], 'base64'));
      row.thumbnail = `/vendor/character-gallery/thumbnails/${row.id}.png`;
      const capture = { id: row.id, name: row.name, family: row.family, image: file, motions: {}, diagnostics: await evaluate(state, 'window.lanternCharacters.diagnostics()[0]') };
      if (args['--motions']) for (const [role, motion] of Object.entries(row.motions)) {
        const image = await evaluate(state, `window.lanternCharacters.capture(${JSON.stringify(row.id)},${JSON.stringify(role)},${motion.duration * 0.45})`);
        const file = resolve(directory, `${row.id}-${role}.png`); await writeFile(file, Buffer.from(image.split(',')[1], 'base64')); capture.motions[role] = file;
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
  } finally { if (!existing) await stopPreview(root); }
});
