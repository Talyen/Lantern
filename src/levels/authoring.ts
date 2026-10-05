import { attachPreviewGraphics, type PreviewGraphicsView } from '../rendering/preview-graphics';
import type { ClearingSnapshot } from '../session/diagnostics';
import { isLine } from '../assets/resource-ownership';
import * as THREE from 'three';
import type { Encounter } from '../gameplay/encounter';
import type { PreparedProbeBake } from '../rendering/lighting-bake';
import type { SurfaceMode } from '../assets/environment-surfaces';
import type { AreaDefinition } from './types';
import { setMaterialCalibration, resetMaterialCalibration, materialCalibration } from '../rendering/material-calibration';
import { calibrationStrengths, type CalibrationFamily } from '../rendering/material-recipes';
type Diagnostics = Pick<ClearingSnapshot, 'area' | 'revision' | 'renderedRevision' | 'ready' | 'errors' | 'missing' | 'contentHash' | 'camera' | 'renderedFrames' | 'phase' | 'updateMs' | 'objects' | 'resources' | 'graphics'>;
type Appearance = { shelterRestored?: boolean; lantern: boolean; surfaces: SurfaceMode };
type Context = { previewGraphics(): PreviewGraphicsView | undefined; invalidate(): void; resetMaterials(): void; resetMeasurements(): void; measurements(): unknown; exportLighting(this: void): Promise<PreparedProbeBake>; lighting(this: void): unknown; appearance(this: void): Appearance; setAppearance(appearance: { surfaces?: SurfaceMode; lantern?: boolean; shelterRestored?: boolean }): Promise<boolean>; scene: THREE.Scene; camera: THREE.OrthographicCamera; renderer: { domElement: HTMLCanvasElement }; definitions(): Record<string, AreaDefinition>; area(): AreaDefinition; encounter: Encounter; changeArea(id: string): Promise<boolean>; restart(this: void): void; inspect(): boolean; waitFrames(count?: number): Promise<void>; setFrozen(value: boolean): void; setView(id: string): void; diagnostics(): Diagnostics };
export function attachAuthoring(ctx: Context) {
  attachPreviewGraphics(() => { const view = ctx.previewGraphics(); return view ? [view] : []; });
  const runtimeId = crypto.randomUUID();
  const diagnostics = () => ({ ...ctx.diagnostics(), runtimeId });
  const panel = document.createElement('aside'); panel.dataset.authoring = 'levels'; panel.style.cssText = 'position:fixed;left:12px;top:12px;z-index:100;background:#172326ee;color:#eee;padding:8px;border-radius:6px;font:12px system-ui;max-width:360px';
  panel.innerHTML = '<select aria-label="Area"></select> <select aria-label="View"></select> <button>Play</button> <button data-restart>Restart</button> <button data-inspect>Inspect rock</button> <label><input type="checkbox" checked> Guides</label><label> Surfaces <select aria-label="Surfaces"><option value="projected">Projected</option><option value="authored">Authored</option><option value="showcase">Woodland showcase</option></select></label><label><input type="checkbox" data-lantern> Lantern</label><pre style="white-space:pre-wrap;margin:6px 0 0"></pre>';
  document.body.append(panel);
  const selects = panel.querySelectorAll('select'), play = panel.querySelector('button')!, guides = panel.querySelector('input')!, status = panel.querySelector('pre')!;
  const calibration = document.createElement('details');
  calibration.innerHTML = '<summary>Material relief</summary>';
  const comparisonControls = new Map<CalibrationFamily, HTMLSelectElement>();
  const compare = (family: CalibrationFamily, strength: number) => {
    setMaterialCalibration(family, strength); comparisonControls.get(family)!.value = String(strength); ctx.resetMaterials(); ctx.invalidate();
  };
  for (const family of ['stone', 'bark', 'ground'] as const) {
    const label = document.createElement('label'), select = document.createElement('select');
    label.textContent = `${family[0].toUpperCase()}${family.slice(1)} `; select.setAttribute('aria-label', `${family} relief`);
    select.replaceChildren(...calibrationStrengths.map(value => new Option(value === 0 ? 'Relief off' : `${value}×`, String(value)))); select.value = '1';
    select.onchange = () => compare(family, Number(select.value)); comparisonControls.set(family, select); label.append(select); calibration.append(label);
  }
  const replay = document.createElement('button'); replay.textContent = 'Replay'; replay.onclick = () => { ctx.restart(); ctx.resetMaterials(); };
  const restore = document.createElement('button'); restore.textContent = 'Reset material comparisons'; restore.onclick = () => {
    resetMaterialCalibration(); comparisonControls.forEach(select => { select.value = '1'; }); ctx.resetMaterials(); ctx.invalidate();
  };
  calibration.append(replay, restore); panel.append(calibration);
  const overlay = new THREE.Group(); ctx.scene.add(overlay); let overlayRevision = -1, frozen = true, selectedView = 'center';
  function clearOverlay(): void { overlay.children.forEach(o => { if (isLine(o)) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); overlay.clear(); }
  function line(points: number[][], color: string): void { const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p as [number, number, number]))), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: .85 })); object.renderOrder = 100; overlay.add(object); }
  function rectangle(width: number, depth: number, yaw: number, position = [0, 0], color = '#eac770'): void {
    const points = [[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2],[-width/2,-depth/2]].map(([x,z]) => [position[0]+x*Math.cos(yaw)+z*Math.sin(yaw), .08, position[1]-x*Math.sin(yaw)+z*Math.cos(yaw)]); line(points, color);
  }
  function refresh(): void {
    const appearance = ctx.appearance();
    panel.querySelector<HTMLInputElement>('[data-lantern]')!.checked = appearance.lantern; selects[2].value = appearance.surfaces;
    const d = ctx.diagnostics(); status.textContent = d.errors.length ? d.errors.join('\n') : `${d.area} · revision ${d.revision} · ${d.ready ? 'Ready' : 'Loading'} · ${Math.round(d.updateMs)} ms${d.missing.length ? '\nIncomplete art: '+d.missing.join(', ') : ''}`;
    if (overlayRevision === d.revision) return;
    panel.querySelector<HTMLButtonElement>('[data-inspect]')!.textContent = 'Inspect rock';
    overlayRevision = d.revision; clearOverlay(); const area = ctx.area(), e = area.envelope;
    rectangle(e.width,e.depth,e.yaw); rectangle(e.screen[0],e.screen[1],e.yaw,[0,0],'#70c5ea'); rectangle(e.width+e.apron*2,e.depth+e.apron*2,e.yaw,[0,0],'#687c80');
    const b = area.layout.boundary; if (b.kind === 'circle') line(Array.from({length:65},(_,i) => [b.center[0]+Math.cos(i/64*Math.PI*2)*b.radius,.08,b.center[1]+Math.sin(i/64*Math.PI*2)*b.radius]),'#88e890'); else line([...b.points,b.points[0]].map(p=>[p[0],.08,p[1]]),'#88e890');
    for (const gate of area.gates) { rectangle(gate.width,gate.depth,gate.yaw,gate.position,'#eb90ed'); const p=gate.arrival; line([[p.position[0],.1,p.position[1]],[p.position[0]+Math.sin(p.yaw),.1,p.position[1]+Math.cos(p.yaw)]],'#ffffff'); }
    for (const r of area.reserved) line(Array.from({length:33},(_,i)=>[r.center[0]+Math.cos(i/32*Math.PI*2)*r.radius,.09,r.center[1]+Math.sin(i/32*Math.PI*2)*r.radius]),'#ef9868');
    selects[0].replaceChildren(...Object.values(ctx.definitions()).map(a=>new Option(a.name,a.id))); selects[0].value=area.id;
    selects[1].replaceChildren(...['overview',...area.views.map(v=>v.id)].map(id=>new Option(id,id))); selects[1].value=selectedView;
  }
  function setView(id: string): void { selectedView=id;ctx.setView(id);ctx.invalidate();selects[1].value=id; }
  function freeze(value: boolean): void { frozen=value;ctx.setFrozen(value);ctx.invalidate();play.textContent=value?'Play':'Freeze'; }
  selects[0].onchange=async()=>{await ctx.changeArea(selects[0].value);setView(selectedView);}; selects[1].onchange=()=>setView(selects[1].value); play.onclick=()=>freeze(!frozen); guides.onchange=()=>{overlay.visible=guides.checked;ctx.invalidate();};
  panel.querySelector<HTMLButtonElement>('[data-restart]')!.onclick = ctx.restart;
  const inspect = () => { panel.querySelector<HTMLButtonElement>('[data-inspect]')!.textContent = ctx.inspect() ? 'Return' : 'Inspect rock'; };
  panel.querySelector<HTMLButtonElement>('[data-inspect]')!.onclick = inspect;
  const setSurfaces = async (surfaces: SurfaceMode) => {
    const changed = await ctx.setAppearance({ surfaces });
    if (changed && surfaces === 'showcase' && ctx.area().id === 'clearing') setView('entrance');
    return changed;
  };
  const appearanceFailed = (error: unknown) => console.error('Unable to update area appearance.', error);
  selects[2].onchange = () => { void setSurfaces(selects[2].value as SurfaceMode).catch(appearanceFailed); };
  const setLantern = (lantern: boolean) => ctx.setAppearance({ lantern });
  panel.querySelector<HTMLInputElement>('[data-lantern]')!.onchange = event => { void setLantern((event.target as HTMLInputElement).checked).catch(appearanceFailed); };
  const bridge = {
    setMaterialCalibration: compare, materialCalibration,
    setShelterRestored: (value: boolean) => ctx.setAppearance({ shelterRestored: value }),
    setSurfaces, setLantern, appearance: ctx.appearance, lighting: ctx.lighting, exportLighting: ctx.exportLighting,
    diagnostics, restart: ctx.restart, inspect, resetMeasurements: () => ctx.resetMeasurements(), measurements: () => ctx.measurements(),
    area: () => ctx.area(),
    selectArea: async(id:string) => {const result=await ctx.changeArea(id);setView(selectedView);return result;},
    setView, freeze,
    overlays: (value:boolean) => {overlay.visible=value;guides.checked=value;ctx.invalidate();},
    clean: (value:boolean) => { if (value && document.querySelector<HTMLDialogElement>('#options-dialog')?.open) document.querySelector<HTMLButtonElement>('#options-close')?.click(); panel.hidden=value;document.querySelectorAll<HTMLElement>('.resource-orb, .enemy-health, #result-panel, #asset-status, #interaction-prompt, #action-bar, #hud-options').forEach(e=>{e.style.visibility=value?'hidden':'';});ctx.invalidate();},
    settle: async(count=16, expected=ctx.diagnostics().revision) => {await ctx.waitFrames(count);const d=ctx.diagnostics();if(!d.ready||d.revision!==expected||d.errors.length)throw new Error('Scene revision changed or is not ready');return d;},
    // Deterministic inspection setup; normal smoke tests still exercise keyboard movement/combat.
    placePlayer: (x:number,z:number,yaw:number) => {ctx.encounter.player.x=x;ctx.encounter.player.z=z;ctx.encounter.player.yaw=yaw;ctx.invalidate();},
    zoom: (value:number) => {ctx.camera.zoom=value;ctx.camera.updateProjectionMatrix();ctx.invalidate();},
  };
  Object.assign(window,{lanternAuthoring:bridge}); refresh(); setView(ctx.appearance().surfaces === 'showcase' && ctx.area().id === 'clearing' ? 'entrance' : 'center');
  const timer=setInterval(refresh,100);window.addEventListener('pagehide',()=>{resetMaterialCalibration();clearInterval(timer);clearOverlay();overlay.removeFromParent();panel.remove();},{once:true});
  return bridge;
}
