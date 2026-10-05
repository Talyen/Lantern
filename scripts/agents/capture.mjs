import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { UsageError } from '../lib/cli.mjs';
import { livePreview } from './preview.mjs';
import { ownedBrowser } from './browser.mjs';
import { withResource } from './resources.mjs';

export async function captureDiagnostics(connection) {
  const snapshot = await connection.evaluate(`(() => {
    const graphics = window.lanternPreviewGraphics?.diagnostics();
    const error = document.querySelector('[data-render-error]')?.dataset.renderError || (document.querySelector('vite-error-overlay') ? 'Vite compilation failed' : undefined);
    return { url: location.href, timeOrigin: performance.timeOrigin, graphics, error };
  })()`);
  if (snapshot.error) throw new Error(snapshot.error);
  const views = snapshot.graphics?.views.filter(view => view.visible);
  if (!views?.length || views.some(view => !view.ready || view.error || view.sceneWidth <= 0 || view.sceneHeight <= 0)) throw new Error('Capture requires every visible view to be ready and free of rendering errors.');
  return snapshot;
}
function captureSignature(snapshot) {
  return JSON.stringify({ url: snapshot.url, timeOrigin: snapshot.timeOrigin, viewport: snapshot.graphics.viewport,
    views: snapshot.graphics.views.filter(view => view.visible).map(({ id, subject, camera, cssWidth, cssHeight, outputWidth, outputHeight, sceneWidth, sceneHeight, settings }) =>
      ({ id, subject, camera, cssWidth, cssHeight, outputWidth, outputHeight, sceneWidth, sceneHeight, settings })) });
}
export function pngSize(image) {
  if (image.length < 24 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Capture did not return a PNG.');
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}
export async function captureScreenshot(connection, output, { overwrite = false } = {}) {
  if (!output.endsWith('.png')) throw new UsageError('--output must name a .png file.');
  const before = await captureDiagnostics(connection);
  const { data } = await connection.screenshot();
  const after = await captureDiagnostics(connection);
  if (captureSignature(before) !== captureSignature(after)) throw new Error('Route, selection, graphics or viewport changed during capture. Retry after the view settles.');
  const image = Buffer.from(data, 'base64'), size = pngSize(image), viewport = before.graphics.viewport;
  if (size.width !== Math.round(viewport.width * viewport.dpr) || size.height !== Math.round(viewport.height * viewport.dpr)) throw new Error('Screenshot dimensions do not match the observed viewport and density.');
  const evidence = { version: 1, capturedAt: new Date().toISOString(), route: before.url, image: size, graphics: before.graphics };
  const metadata = output.slice(0, -4) + '.json';
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, image, { flag: overwrite ? 'w' : 'wx' });
  try { await writeFile(metadata, JSON.stringify(evidence, null, 2) + '\n', { flag: overwrite ? 'w' : 'wx' }); }
  catch (error) { if (!overwrite) await rm(output); throw error; }
  return evidence;
}
export async function capturePreview(cwd, output) {
  if (!output.endsWith('.png')) throw new UsageError('--output must name a .png file.');
  const state = await livePreview(cwd);
  if (!state?.browser || !state.ready || !state.gpuLease) throw new Error('Start this task’s owned browser with agent:dev --browser before capturing.');
  // Borrow only this verified preview's existing GPU lease; never admit another browser.
  const previous = process.env.LANTERN_LEASES;
  process.env.LANTERN_LEASES = JSON.stringify({ ...JSON.parse(previous ?? '{}'), gpu: state.gpuLease });
  try {
    return await withResource('gpu', async () => {
      const connection = await ownedBrowser(state);
      try { await captureScreenshot(connection, output); return `Captured ${output} and ${output.slice(0, -4)}.json`; }
      finally { await connection.close(); }
    }, { cwd });
  } finally {
    if (previous === undefined) delete process.env.LANTERN_LEASES; else process.env.LANTERN_LEASES = previous;
  }
}
