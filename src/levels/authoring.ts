import * as THREE from 'three';
import type { Encounter } from '../gameplay/encounter';
import type { PreparedProbeBake } from '../rendering/lighting-bake';
import { lightingModeLabels, type LightingProfileId } from './lighting-profiles';
import type { LightingMode } from './environment-lighting';
import type { SurfaceMode } from '../assets/environment-surfaces';
import type { AreaDefinition } from './types';
type Diagnostics = { area: string; revision: number; renderedRevision: number; ready: boolean; errors: string[]; missing: string[]; contentHash: string; camera: unknown; renderedFrames: number; phase: string; updateMs: number; objects: number; resources: unknown; graphics: unknown };
type Appearance = { profile?: LightingProfileId; lantern: boolean; lighting: LightingMode; forcedLighting?: LightingMode; surfaces: SurfaceMode };
type Context = { lightingProfiles(): { id: LightingProfileId; label: string }[]; lightingModes(): LightingMode[]; exportLighting(): Promise<PreparedProbeBake>; lighting(): unknown; appearance(): Appearance; setAppearance(appearance: { lighting?: LightingMode | 'random'; surfaces?: SurfaceMode; profile?: LightingProfileId | 'area'; lantern?: boolean }): Promise<boolean>; scene: THREE.Scene; camera: THREE.OrthographicCamera; renderer: { domElement: HTMLCanvasElement }; definitions(): Record<string, AreaDefinition>; area(): AreaDefinition; encounter: Encounter; changeArea(id: string): Promise<boolean>; restart(): void; inspect(): boolean; waitFrames(count?: number): Promise<void>; setFrozen(value: boolean): void; setView(id: string): void; diagnostics(): Diagnostics };
export function attachAuthoring(ctx: Context): void {
  const runtimeId = crypto.randomUUID();
  const diagnostics = () => ({ ...ctx.diagnostics(), runtimeId });
  const panel = document.createElement('aside'); panel.dataset.authoring = 'levels'; panel.style.cssText = 'position:fixed;left:12px;top:12px;z-index:100;background:#172326ee;color:#eee;padding:8px;border-radius:6px;font:12px system-ui;max-width:360px';
  panel.innerHTML = '<select aria-label="Area"></select> <select aria-label="View"></select> <button>Play</button> <button data-restart>Restart</button> <button data-inspect>Inspect rock</button> <label><input type="checkbox" checked> Guides</label><label> Light <select aria-label="Lighting"><option value="random">Automatic</option><option value="golden">Golden</option><option value="silver">Silver</option></select></label><label> Surfaces <select aria-label="Surfaces"><option value="projected">Projected</option><option value="authored">Authored</option></select></label><label> Profile <select aria-label="Lighting profile"></select></label><label><input type="checkbox" data-lantern> Lantern</label><pre style="white-space:pre-wrap;margin:6px 0 0"></pre>';
  document.body.append(panel);
  const selects = panel.querySelectorAll('select'), play = panel.querySelector('button')!, guides = panel.querySelector('input')!, status = panel.querySelector('pre')!;
  const overlay = new THREE.Group(); ctx.scene.add(overlay); let overlayRevision = -1, frozen = true, selectedView = 'center';
  function clearOverlay(): void { overlay.children.forEach(o => { if (o instanceof THREE.Line) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); overlay.clear(); }
  function line(points: number[][], color: string): void { const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p as [number, number, number]))), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: .85 })); object.renderOrder = 100; overlay.add(object); }
  function rectangle(width: number, depth: number, yaw: number, position = [0, 0], color = '#eac770'): void {
    const points = [[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2],[-width/2,-depth/2]].map(([x,z]) => [position[0]+x*Math.cos(yaw)+z*Math.sin(yaw), .08, position[1]-x*Math.sin(yaw)+z*Math.cos(yaw)]); line(points, color);
  }
  let modeListKey: string | null = null;
  function refresh(): void {
    const modes = ctx.lightingModes();
    if (modeListKey !== modes.join(',') || !selects[2].options.length) {
      modeListKey = modes.join(',');
      selects[2].replaceChildren(new Option(modes.length ? 'Automatic' : 'Default', 'random'), ...modes.map(mode => new Option(lightingModeLabels[mode], mode)));
    }
    selects[2].disabled = !modes.length;
    const appearance = ctx.appearance();
    if (!selects[4].options.length) selects[4].replaceChildren(new Option('Area profile', 'area'), ...ctx.lightingProfiles().map(p => new Option(p.label, p.id)));
    selects[4].value = appearance.profile ?? 'area'; panel.querySelector<HTMLInputElement>('[data-lantern]')!.checked = appearance.lantern; selects[2].value = modes.includes(appearance.forcedLighting!) ? appearance.forcedLighting! : 'random'; selects[3].value = appearance.surfaces;
    panel.querySelector<HTMLButtonElement>('[data-inspect]')!.hidden = !ctx.area().inspection;
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
  function setView(id: string): void { selectedView=id;ctx.setView(id);selects[1].value=id; }
  function freeze(value: boolean): void { frozen=value;ctx.setFrozen(value);play.textContent=value?'Play':'Freeze'; }
  selects[0].onchange=async()=>{await ctx.changeArea(selects[0].value);setView(selectedView);}; selects[1].onchange=()=>setView(selects[1].value); play.onclick=()=>freeze(!frozen); guides.onchange=()=>overlay.visible=guides.checked;
  panel.querySelector<HTMLButtonElement>('[data-restart]')!.onclick = ctx.restart;
  const inspect = () => { panel.querySelector<HTMLButtonElement>('[data-inspect]')!.textContent = ctx.inspect() ? 'Return' : 'Inspect rock'; };
  panel.querySelector<HTMLButtonElement>('[data-inspect]')!.onclick = inspect;
  const setLighting = (lighting: LightingMode | 'random') => ctx.setAppearance({ lighting });
  const setSurfaces = (surfaces: SurfaceMode) => ctx.setAppearance({ surfaces });
  selects[2].onchange = () => { void setLighting(selects[2].value as LightingMode | 'random'); };
  selects[3].onchange = () => { void setSurfaces(selects[3].value as SurfaceMode); };
  const setProfile = (profile: LightingProfileId | 'area') => ctx.setAppearance({ profile });
  const setLantern = (lantern: boolean) => ctx.setAppearance({ lantern });
  selects[4].onchange = () => { void setProfile(selects[4].value as LightingProfileId | 'area'); };
  panel.querySelector<HTMLInputElement>('[data-lantern]')!.onchange = event => { void setLantern((event.target as HTMLInputElement).checked); };
  const bridge = {
    setLighting, setSurfaces, setProfile, setLantern, appearance: ctx.appearance, lighting: ctx.lighting, exportLighting: ctx.exportLighting,
    diagnostics, restart: ctx.restart, inspect,
    area: () => ctx.area(),
    selectArea: async(id:string) => {const result=await ctx.changeArea(id);setView(selectedView);return result;},
    setView, freeze,
    overlays: (value:boolean) => {overlay.visible=value;guides.checked=value;},
    clean: (value:boolean) => { if (value && document.querySelector<HTMLDialogElement>('#options-dialog')?.open) document.querySelector<HTMLButtonElement>('#options-close')?.click(); panel.hidden=value;document.querySelectorAll<HTMLElement>('.resource-orb, .enemy-health, #result-panel, #asset-status, #interaction-prompt, #save-status').forEach(e=>{e.style.visibility=value?'hidden':'';});},
    settle: async(count=16, expected=ctx.diagnostics().revision) => {await ctx.waitFrames(count);const d=ctx.diagnostics();if(!d.ready||d.revision!==expected||d.errors.length)throw new Error('Scene revision changed or is not ready');return d;},
    // Deterministic inspection setup; normal smoke tests still exercise keyboard movement/combat.
    placePlayer: (x:number,z:number,yaw:number) => {ctx.encounter.player.x=x;ctx.encounter.player.z=z;ctx.encounter.player.yaw=yaw;},
    zoom: (value:number) => {ctx.camera.zoom=value;ctx.camera.updateProjectionMatrix();},
  };
  Object.assign(window,{lanternAuthoring:bridge}); refresh(); setView('center');
  const timer=setInterval(refresh,100);window.addEventListener('pagehide',()=>{clearInterval(timer);clearOverlay();overlay.removeFromParent();panel.remove();},{once:true});
}
