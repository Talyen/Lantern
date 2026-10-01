/** Own one isolated headless browser and Vite server; capture via the shared WebGPU gallery. */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { cli, parseArgs, root, run, UsageError } from '../../lib/cli.mjs';
const execute = promisify(execFile);
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--limit': 'value', '--motions': 'boolean', '--family': 'value' });
  if (args['--help']) { console.log('Usage: npm run characters:capture -- [--limit N] [--motions] [--family NAME]\nExports roster thumbnails/contact sheets; --motions also captures idle/run/attack review sheets.'); return; }
  if (args['--limit'] && (!Number.isInteger(Number(args['--limit'])) || Number(args['--limit']) < 1)) throw new UsageError('--limit must be a positive integer');
  const directory = resolve(root, '.local/character-gallery');
  const vendor = resolve(root, 'public/vendor/character-gallery');
  await mkdir(directory, { recursive: true }); await mkdir(resolve(vendor, 'thumbnails'), { recursive: true });
  const catalog = JSON.parse(await readFile(resolve(vendor, 'catalog.json'), 'utf8'));
  if (!catalog.complete && !args['--limit']) throw new Error('Finish character exports before capturing the complete roster.');
  if (args['--family'] && !catalog.characters.some(row => row.family === args['--family'])) throw new UsageError('Unknown character family');
  const previous = args['--family'] ? JSON.parse(await readFile(resolve(directory, 'captures.json'), 'utf8')) : null;
  const session = `lantern-characters-${randomUUID()}`;
  const browser = async argv => (await execute('agent-browser', ['--session', session, '--headed', 'false', ...argv], { cwd: root, timeout: 30000, maxBuffer: 20 * 1024 * 1024 })).stdout;
  const evaluate = async script => { const result = JSON.parse(await browser(['--json', 'eval', script])); if (!result.success) throw new Error(result.error); return result.data.result; };
  const port = await new Promise((accept, reject) => { const server = createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => accept(port)); }); });
  const log = await open(resolve(directory, 'capture-vite.log'), 'w');
  const child = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', log.fd, log.fd] });
  const captures = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) { try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    if (!ready) throw new Error('Capture server did not start');
    await browser(['open', `http://127.0.0.1:${port}/?lab=characters`]);
    await browser(['set', 'viewport', '1200', '900']);
    await evaluate(`(async()=>{for(let i=0;i<300;i++){if(window.lanternCharacters)return true;const e=document.querySelector('[data-render-error]');if(e)throw new Error(e.dataset.renderError);await new Promise(r=>setTimeout(r,50));}throw new Error('Gallery startup failed');})()`);
    await browser(['snapshot', '-i']);
    await browser(['screenshot', 'body', resolve(directory, 'gallery-startup.png')]);
    // Gut check the real route before starting the batch.
    if (await evaluate(`!!document.querySelector('vite-error-overlay')`) || !(await evaluate(`document.title.includes('Characters')`))) throw new Error('Gallery browser verification failed');
    for (const row of catalog.characters.filter(row => !args['--family'] || row.family === args['--family']).slice(0, Number(args['--limit']) || catalog.characters.length)) {
      const image = await evaluate(`window.lanternCharacters.capture(${JSON.stringify(row.id)})`);
      const file = resolve(vendor, 'thumbnails', `${row.id}.png`);
      await writeFile(file, Buffer.from(image.split(',')[1], 'base64'));
      row.thumbnail = `/vendor/character-gallery/thumbnails/${row.id}.png`;
      const capture = { id: row.id, name: row.name, family: row.family, image: file, motions: {}, diagnostics: await evaluate('window.lanternCharacters.diagnostics()[0]') };
      if (args['--motions']) for (const [role, motion] of Object.entries(row.motions)) {
        const image = await evaluate(`window.lanternCharacters.capture(${JSON.stringify(row.id)},${JSON.stringify(role)},${motion.duration * 0.45})`);
        const file = resolve(directory, `${row.id}-${role}.png`); await writeFile(file, Buffer.from(image.split(',')[1], 'base64')); capture.motions[role] = file;
      }
      captures.push(capture); console.log(`Captured ${captures.length}: ${row.family} / ${row.name}`);
    }
    const errors = await browser(['errors']); if (errors.trim()) throw new Error(`Browser errors: ${errors}`);
    await writeFile(resolve(vendor, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
    const merged = new Map((previous?.captures ?? []).map(row => [row.id, row]));
    captures.forEach(row => merged.set(row.id, row));
    const records = catalog.characters.flatMap(row => merged.has(row.id) ? [merged.get(row.id)] : []);
    await writeFile(resolve(directory, 'captures.json'), JSON.stringify({ expectedCount: catalog.expectedCount, captures: records, browserErrors: errors }, null, 2) + '\n');
    await run('python3', [resolve(root, 'scripts/assets/characters/contact-sheet.py'), directory]);
    console.log(`Character contact sheets: ${directory}`);
  } finally { await browser(['close']).catch(() => {}); child.kill('SIGTERM'); await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); }); await log.close(); }
});
