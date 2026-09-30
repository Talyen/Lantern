import { preview } from 'vite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, parseArgs, root } from './lib/cli.mjs';
export async function verifyResources(origin) {
  const response = await fetch(origin, { signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Preview HTML unavailable');
  const html = await response.text();
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => [match[1], 'javascript']);
  const styles = [...html.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["']/gi)].map((match) => [match[1], 'css']);
  if (!scripts.length) throw new Error('Preview has no application script');
  for (const [path, type] of [...scripts, ...styles]) {
    const url = new URL(path, origin);
    if (url.origin !== new URL(origin).origin) throw new Error(`Unexpected remote build resource: ${url}`);
    const resource = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const mime = resource.headers.get('content-type')?.split(';')[0];
    const expected = type === 'css' ? ['text/css'] : ['text/javascript', 'application/javascript'];
    if (!resource.ok || !expected.includes(mime) || !(await resource.arrayBuffer()).byteLength) throw new Error(`Invalid ${type} resource: ${path}`);
  }
  console.log(`Preview resources passed: ${scripts.length} scripts, ${styles.length} styles. Gameplay remains a manual check.`);
}
export async function smokePreview() {
  const server = await preview({ root, configFile: resolve(root, 'vite.config.ts'), preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  try { await verifyResources(`http://127.0.0.1:${server.httpServer.address().port}/`); }
  finally { await server.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) { console.log('Usage: npm run smoke:preview'); return; }
  await smokePreview();
});
