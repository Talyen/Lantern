import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { createRenderer } from '../../rendering/renderer';
import { resizeDisplay } from '../../rendering/display-resolution';
import { WebGPUPipeline } from '../../rendering/webgpu-pipeline';
import { resolveLighting } from '../../levels/lighting';
import { defaults } from '../../rendering/graphics-settings';
import { prepareSurfaceMaterial } from '../../rendering/surface-detail';
import { CoreEffects } from '../../rendering/effects';
import { disposeSceneResources } from '../../assets/resource-ownership';
import { ComparisonVideo } from './video';
import { comparisonPreset, fsrComparison, selectComparisonPreset, resetComparisonRandom } from './settings';

type Subject = 'foliage' | 'smoke' | 'texture';
const subjects: Subject[] = ['foliage', 'smoke', 'texture'];
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
function image(canvas: HTMLCanvasElement): string {
  const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
  copy.getContext('2d')!.drawImage(canvas, 0, 0); return copy.toDataURL();
}
function fern() {
  const vertices: number[] = [];
  // Original diagnostic geometry: thin leaf tips expose temporal edge stability.
  for (let row = 0; row < 13; row++) for (const side of [-1, 1]) {
    const y = .12 + row * .062, length = .22 * (1 - row / 20), width = .008 + (row % 3) * .004;
    vertices.push(0,y,0,side*length,y+.065,0,side*length*.55,y+width,0);
  }
  vertices.push(-.003,0,0,.003,0,0,0,1,0);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3)); geometry.computeVertexNormals();
  const material = new MeshStandardNodeMaterial({color:'#647c49',roughness:1,side:THREE.DoubleSide});
  return new THREE.Mesh(geometry, material);
}
function weave() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(1024,1024);
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const broad = ((x >> 5) + (y >> 5)) % 2, thread = (x % 8 < 2 ? 22 : 0) + (y % 8 < 2 ? 18 : 0);
    const grain = ((x * 13 + y * 31) % 11) - 5, value = 90 + broad * 26 + thread + grain;
    pixels.data.set([value+25,value+10,value-8,255],(y*1024+x)*4);
  }
  ctx.putImageData(pixels,0,0);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(12,12);
  return map;
}
function smokeBillboard() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!, map = new THREE.CanvasTexture(canvas);
  const material = new MeshBasicNodeMaterial({map,color:'#626d75',transparent:true,opacity:.65,depthWrite:false});
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6,.8),material); mesh.position.y = .12;
  return {mesh,advance(time: number) {
    ctx.clearRect(0,0,512,256);
    for (let i=0;i<4;i++) {
      const x = ((time*.4+i*.21)%1)*650-65, y = 128+Math.sin(time+i)*25, radius = 48+i*7;
      const gradient = ctx.createRadialGradient(x,y,0,x,y,radius);gradient.addColorStop(0,'#ffffff');gradient.addColorStop(.45,'#ffffffb0');gradient.addColorStop(1,'#ffffff00');
      ctx.fillStyle=gradient;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
    }
    map.needsUpdate=true;
  }};
}
function fixture(subject: Subject, aspect: number) {
  const look = resolveLighting(), scene = new THREE.Scene(); scene.background = new THREE.Color(look.background);
  const ambient = new THREE.HemisphereLight(look.ambient.sky,look.ambient.ground,look.ambient.intensity);
  const sun = new THREE.DirectionalLight(look.sun.color,look.sun.intensity); sun.position.fromArray(look.sun.position); scene.add(ambient,sun);
  const effects = new CoreEffects(); scene.add(effects.root);
  let camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  let smoke: ReturnType<typeof smokeBillboard> | undefined;
  let time = 0;
  const target = new THREE.Vector3();
  if (subject === 'texture') {
    camera = new THREE.PerspectiveCamera(40,aspect,.05,30); camera.position.set(0,1.5,2.6); target.set(0,0,-1); camera.lookAt(target);
    const map = weave(), material = new MeshStandardNodeMaterial({map,roughness:1}); prepareSurfaceMaterial(material);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8,12),material); floor.rotation.x = -Math.PI/2; scene.add(floor);
  } else {
    const span = subject === 'foliage' ? .48 : .9;
    camera = subject === 'smoke' ? new THREE.PerspectiveCamera(35,aspect,.05,20) : new THREE.OrthographicCamera(-span*aspect/2,span*aspect/2,span/2,-span/2,.05,20);
    target.set(0,subject === 'foliage' ? .77 : .12,0); camera.position.copy(target).add(new THREE.Vector3(0,0,subject === 'smoke' ? 1.5 : 3)); camera.lookAt(target);
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(5,5),new MeshBasicNodeMaterial({color:subject === 'foliage' ? '#abae97' : '#707b7b'})); backdrop.position.set(0,.5,-.7); scene.add(backdrop);
    if (subject === 'foliage') { const plant = fern(); scene.add(plant); effects.addFoliage(plant); }
    else {
      // Texture animation has no geometric motion vector. This controlled
      // billboard isolates reactivity while using the smoke color and deliberately dense opacity in both versions.
      smoke = smokeBillboard(); scene.add(smoke.mesh);
    }
  }
  const origin = camera.position.clone(), originalTarget = target.clone();
  return {scene,camera,target,effects,look,
    advance(frame: number, dt: number) {
      effects.paused = false; effects.update(dt); time += dt; smoke?.advance(time);
      if (subject === 'texture') { const pan = Math.max(0,Math.min(1,(frame-30)/180))*.45; camera.position.copy(origin); camera.position.x += pan; target.copy(originalTarget); target.x += pan; camera.lookAt(target); }
    },
    dispose() { effects.dispose(); disposeSceneResources(scene); },
  };
}

const mount = document.getElementById('scene')!;
const renderer = await createRenderer(mount);
mount.style.cssText = 'position:fixed;inset:0;background:#15191e'; renderer.domElement.style.cssText = 'width:100%;height:100%';
document.body.replaceChildren(mount);
let running = false, progress = 'Ready';
function resize(): void { resizeDisplay(renderer, Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight)); }
const observer = new ResizeObserver(resize); observer.observe(mount); window.addEventListener('resize', resize); resize();
async function capture(subject: Subject, candidate: boolean, record = true) {
  if (!subjects.includes(subject) || running) throw new Error('Unknown subject or another capture is running.');
  resize();
  const width = renderer.domElement.width, height = renderer.domElement.height, ratio = renderer.getPixelRatio();
  function unchangedOutput(): void {
    resize();
    if (renderer.domElement.width !== width || renderer.domElement.height !== height || renderer.getPixelRatio() !== ratio) throw new Error('Display changed during capture. Keep the viewport and display density fixed and retry.');
  }
  running = true; progress = 'Preparing';
  const preset = candidate ? subject === 'foliage' ? 'foliage-motion' : subject === 'smoke' ? 'reactive-coverage' : 'mip-minus-one' : 'baseline';
  selectComparisonPreset(preset); resetComparisonRandom();
  const stage = fixture(subject, width / height), pipeline = new WebGPUPipeline(renderer,stage.scene,stage.camera,stage.target);
  const settings = {...defaults(),upscaleQuality:'quality' as const,sharpness:.5,dof:'off' as const,ao:0,bloom:subject === 'smoke' ? .4 : 0,outlines:false};
  let video: ComparisonVideo | undefined;
  try {
    pipeline.configure(settings,stage.look.saturation ?? .84,stage.look); await pipeline.ready();
    for (let i=0;i<120;i++) { await nextFrame(); unchangedOutput(); resetComparisonRandom(74103+i); stage.advance(-1,1/60); pipeline.render(); }
    pipeline.resetHistory();
    for (let i=0;i<64;i++) { await nextFrame(); unchangedOutput(); stage.advance(-1,0); pipeline.render(); }
    const images: Record<string,string> = {still:image(renderer.domElement)};
    const inputsBefore = await pipeline.comparisonInputs();
    const trace: {frame:number;camera:number[];target:number[];effects:ReturnType<CoreEffects['comparisonState']>}[] = [];
    if (record) video = new ComparisonVideo(width,height);
    for (let frame=0;frame<240;frame++) {
      await nextFrame(); unchangedOutput(); resetComparisonRandom(74223+frame); stage.advance(frame,1/60); pipeline.render(); progress = `Frame ${frame+1}/240`;
      if ([0,60,120,180,239].includes(frame)) { images[`frame-${frame}`]=image(renderer.domElement); trace.push({frame,camera:stage.camera.position.toArray(),target:stage.target.toArray(),effects:stage.effects.comparisonState()}); }
      if (video) await video.frame(renderer.domElement,frame);
    }
    const inputsAfter = await pipeline.comparisonInputs(), clip = video ? await video.finish() : null;
    if (mount.dataset.renderError) throw new Error(mount.dataset.renderError);
    progress = 'Complete';
    return {subject,candidate,output:{width,height,pixelRatio:ratio},preset:comparisonPreset,settings,pipeline:pipeline.diagnostics(),fixture:'Controlled close-up with original diagnostic geometry; smoke is a texture-animated diagnostic billboard with shipping color and dense .65 opacity in both versions; texture uses a synthetic weave',seed:74103,timestep:1/60,warmupFrames:120,settlingFrames:64,frames:240,seconds:4,trace,images,inputsBefore,inputsAfter,video:clip};
  } finally {video?.close();pipeline.dispose();stage.dispose();running=false;}
}
Object.assign(window,{lanternFsrFocused:{capture,status:()=>({running,progress,preset:comparisonPreset})}});
window.addEventListener('pagehide',()=>{observer.disconnect();window.removeEventListener('resize',resize);void renderer.dispose().catch((error:unknown)=>console.error(error));},{once:true});
if (!fsrComparison) throw new Error('Focused examples require development comparison settings.');
