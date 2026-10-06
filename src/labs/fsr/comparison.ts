import { type OrthographicCamera, type Vector3 } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Graphics } from '../../rendering/graphics';
import { defaults } from '../../rendering/graphics-settings';
import type { FrameLoop } from '../../session/frame-loop';
import type { EncounterView } from '../../gameplay/state-view';
import { fsrComparison, comparisonPreset, comparisonPresets, selectComparisonPreset, resetComparisonRandom } from './settings';
import { ComparisonVideo } from './video';

type Context = {
  graphics: Graphics; frameLoop: FrameLoop; camera: OrthographicCamera; controls: OrbitControls; canvas: HTMLCanvasElement;
  encounter: EncounterView; prepareFixture(): void; diagnostics(): { ready: boolean; errors: string[]; missing: string[]; contentHash: string; revision: number };
  freeze(value: boolean): void; clean(): void; foliageFixture(): void; step(dt: number, movement: { x: number; z: number }, attack: boolean): boolean;
};
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
function png(canvas: HTMLCanvasElement): string {
  const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
  copy.getContext('2d')!.drawImage(canvas, 0, 0); return copy.toDataURL();
}
/** Uses the actual coordinator, art, animation and shared visual graph. */
export function attachFsrComparison(ctx: Context) {
  if (!import.meta.env.DEV || !fsrComparison) return;
  let running = false, progress = 'Ready', disposed = false;
  const controls = document.createElement('div'); controls.dataset.fsrComparison = '';
  controls.style.cssText = 'position:fixed;top:8px;right:8px;z-index:50;background:#17191f;color:white;padding:8px';
  const select = document.createElement('select'); select.ariaLabel = 'FSR comparison preset';
  for (const preset of Object.keys(comparisonPresets)) select.add(new Option(preset, preset)); select.value = comparisonPreset!;
  select.onchange = () => choose(select.value);
  const replay = document.createElement('button'); replay.textContent = 'Replay comparison';
  replay.onclick = () => { void capture(false).catch((error: unknown) => { progress = String(error); console.error(error); }); };
  controls.append(select, replay); document.body.append(controls);
  const target = ctx.controls.target.clone(), offset = ctx.camera.position.clone().sub(target);
  function choose(name: string): void {
    if (running) throw new Error('Wait for the current capture to finish.');
    selectComparisonPreset(name); select.value = name;
    const url = new URL(location.href); url.searchParams.set('fsrCompare', name); url.searchParams.set('sharpness', String(fsrComparison!.sharpness)); history.replaceState({}, '', url.href);
  }
  const still = { x: 0, z: 0 };
  function cameraAt(position: Vector3): void { ctx.controls.target.copy(position); ctx.camera.position.copy(position).add(offset); ctx.controls.update(); }
  async function capture(record = true) {
    if (disposed) throw new Error('Comparison session has closed.');
    if (running) throw new Error('A comparison capture is already running.');
    const initial = ctx.diagnostics();
    if (!initial.ready || initial.errors.length || initial.missing.length) throw new Error('Comparison requires ready, complete playable art.');
    if (ctx.canvas.width !== 1920 || ctx.canvas.height !== 1080) throw new Error('Comparison output must be 1920×1080.');
    running = true; ctx.frameLoop.setManual(true); controls.hidden = true; ctx.clean();
    let video: ComparisonVideo | undefined;
    const images: Record<string, string> = {}, trace: { frame: number; player: number[]; camera: number[]; action: string; effects: ReturnType<Graphics['effects']['comparisonState']> }[] = [];
    try {
      ctx.canvas.dispatchEvent(new PointerEvent('pointerleave'));
      ctx.graphics.apply({ ...defaults(), upscaleQuality: 'quality', sharpness: fsrComparison!.sharpness });
      ctx.graphics.flushSettings(); await ctx.graphics.ready();
      ctx.freeze(true); ctx.foliageFixture(); ctx.graphics.effects.resetComparisonPools(); resetComparisonRandom();
      // A private, save-free camp inspection. Won phase prevents enemy AI or rewards.
      ctx.prepareFixture();
      target.set(1.5, .9, -6); ctx.camera.zoom = 1 / .6; ctx.camera.updateProjectionMatrix(); cameraAt(target);
      for (let i = 0; i < 120; i++) { await nextFrame(); resetComparisonRandom(74103 + i); if (!ctx.step(1 / 60, still, false)) throw new Error('Warm-up frame was not rendered.'); }
      ctx.graphics.resetHistory();
      for (let i = 0; i < 64; i++) { await nextFrame(); if (!ctx.step(0, still, false)) throw new Error('Settling frame was not rendered.'); }
      if (!ctx.graphics.effects.comparisonState().foliageMeshes) throw new Error('Foliage fixture contains no wind-deformed meshes.');
      images.still = png(ctx.canvas);
      const inputsBefore = await ctx.graphics.comparisonInputs();
      if (record) video = new ComparisonVideo(1920, 1080);
      const origin = target.clone();
      for (let frame = 0; frame < 480; frame++) {
        progress = `Frame ${frame + 1}/480`;
        const pan = Math.max(0, Math.min(1, (frame - 120) / 180));
        const eased = pan * pan * (3 - 2 * pan);
        target.copy(origin); target.x += eased * 1.5; target.z -= eased * 1.5; cameraAt(target);
        await nextFrame();
        resetComparisonRandom(74103 + 120 + frame);
        if (!ctx.step(1 / 60, frame >= 120 && frame < 155 ? { x: .35, z: 0 } : still, frame === 310)) throw new Error('Replay frame was not rendered.');
        if ([0, 240, 330, 479].includes(frame)) {
          images[`frame-${frame}`] = png(ctx.canvas);
          trace.push({ frame, player: [ctx.encounter.player.x, ctx.encounter.player.y, ctx.encounter.player.z, ctx.encounter.player.yaw], camera: ctx.camera.position.toArray(), action: ctx.encounter.playerAction ? 'attack' : 'idle', effects: ctx.graphics.effects.comparisonState() });
        }
        // Copy PNGs before encoding can yield across browser presentation, which
        // clears the transient WebGPU canvas drawing buffer.
        if (video) await video.frame(ctx.canvas, frame);
      }
      const inputsAfter = await ctx.graphics.comparisonInputs();
      if (!trace.some(sample => sample.action === 'ability' || sample.action === 'attack')) throw new Error('Comparison attack did not play.');
      const data = video ? await video.finish() : null;
      progress = 'Complete';
      const final = ctx.diagnostics();
      if (final.contentHash !== initial.contentHash || final.revision !== initial.revision || final.errors.length) throw new Error('Scene changed or failed during comparison.');
      return { preset: comparisonPreset, settings: { ...defaults(), sharpness: fsrComparison!.sharpness }, pipeline: ctx.graphics.pipelineDiagnostics(), fixture: 'Camp with authored tree meshes using the existing foliage wind helper in every variant; authoring guides hidden', seed: 74103, timestep: 1 / 60, warmupFrames: 120, settlingFrames: 64, frames: 480, seconds: 8, trace,
        contentHash: final.contentHash, revision: final.revision, missing: final.missing, errors: final.errors, images, inputsBefore, inputsAfter, video: data };
    } finally {
      video?.close(); running = false; ctx.freeze(true);
      // Remain frozen after review; the private fixture never resumes ordinary play.
      if (!disposed) { controls.hidden = false; ctx.frameLoop.setManual(false); }
    }
  }
  const bridge = { capture, select: choose, status: () => ({ running, progress, preset: comparisonPreset }) };
  Object.assign(window, { lanternFsrComparison: bridge });
  return { dispose: () => {
    disposed = true; controls.remove();
    if (Reflect.get(window, 'lanternFsrComparison') === bridge) Reflect.deleteProperty(window, 'lanternFsrComparison');
  } };
}
