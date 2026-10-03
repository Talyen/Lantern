import * as THREE from 'three';
import { impact } from 'tslfx';
import { ArrowRainParticles, type ImpactEvent } from './arrow-rain-particles';
import { arrowRainSequence } from '../gameplay/arrow-rain-sequence';
import { MeshBasicNodeMaterial, type WebGPURenderer, type Node } from 'three/webgpu';
import { color, mx_noise_float, smoothstep, uniform, uv } from 'three/tsl';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetLibrary, type AssetInstance } from '../assets/asset-library';
import { isMesh, disposeSceneInstances, disposeSceneResources } from '../assets/resource-ownership';
import { arrowAsset } from '../gameplay/equipment';
import { particlePresets, type QualityLevel } from './quality-presets';

export const ultimateSequences={'arrow-rain':{name:'Rain of Arrows',...arrowRainSequence}} as const;
const smooth = (a: number, b: number, value: number) => THREE.MathUtils.smoothstep(value, a, b);
const random = (index: number, salt: number) => { let n = Math.imul(index + 71, 374761393) ^ Math.imul(salt + 19, 668265263); n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
type ImpactShader = { nodes: { colorNode: Node<'vec4'> }; uniforms: { time: { value: number } } };
type GroundImpact = { event: ImpactEvent; mesh: THREE.Mesh; shader: ImpactShader; fade: { value: number } };
type RainArrow = { position: THREE.Vector3; impact: number; object: THREE.Object3D; launch: boolean; disabled?: boolean };
type ArtManifest = { version: number; recipes: { id: string; emitters: { name: string; mesh: string | null; material: { texture: string | null } }[] }[] };

/** The adopted rain presentation. Numeric damage and clocks belong to gameplay. */
export class ArrowRainEffects {
  readonly root = new THREE.Group();
  enabled = true;
  private targetHits: number[][] = [];
  private rainOpacity = uniform(0);
  private materials = new Set<THREE.Material>();
  private geometries = new Set<THREE.BufferGeometry>();
  private textures = new Set<THREE.Texture>();
  private rainFootprint?: THREE.Mesh;
  private particles?: ArrowRainParticles;
  private impactEvents: ImpactEvent[] = [];
  private groundImpacts: GroundImpact[] = [];
  private arrows: RainArrow[] = [];
  private arrowAsset?: AssetInstance;
  private bowPosition = new THREE.Vector3();
  private bowDirection = new THREE.Vector3(0, 1, 0);
  private launchPosition = new THREE.Vector3();
  private launchDirection = new THREE.Vector3(0, 1, 0);
  private launchTrail?: THREE.Mesh<THREE.BufferGeometry, MeshBasicNodeMaterial>;
  private density: number;
  private activeArrows=32;
  private qualityApplied=false;
  private disposed = false;
  private ready?: Promise<void>;
  constructor(private ground: THREE.Mesh, position: THREE.Vector3, yaw: number, quality: QualityLevel, private renderer: WebGPURenderer, private scene: THREE.Object3D, private targets: THREE.Vector3[] = []) {
    this.root.position.copy(position); this.root.rotation.y = yaw; this.root.updateMatrixWorld(true);
    this.root.userData.transient = true;
    this.density = particlePresets[quality].emission;
    this.activeArrows=Math.max(18,Math.round(32*this.density));
  }
  prepare(): Promise<void> {
    return this.ready ??= this.prepareArt().catch((error: unknown) => { this.release(); throw error; });
  }
  private ownGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry { this.geometries.add(geometry); return geometry; }
  private ownMaterial(material: MeshBasicNodeMaterial): MeshBasicNodeMaterial { this.materials.add(material); return material; }
  private async prepareArt(): Promise<void> {
    const response = await fetch('/vendor/synty/ability-effects/arrow-rain.json');
    if (!response.ok) throw new Error('Prepare Synty art with npm run assets:prepare-particle-study.');
    const data = await response.json() as ArtManifest;
    if (data.version !== 1 || !Array.isArray(data.recipes)) throw new Error('Unsupported Synty art export.');
    const dust = data.recipes.find(r => r.id === 'Impact_Small')?.emitters.find(e => /Dust/.test(e.name));
    const spark = data.recipes.find(r => r.id === 'SwordSlash')?.emitters.find(e => e.mesh);
    if (!dust?.material.texture || !spark?.mesh) throw new Error('Synty dust texture or spark mesh is missing.');
    const map = await new THREE.TextureLoader().loadAsync(dust.material.texture); map.colorSpace = THREE.SRGBColorSpace; this.textures.add(map);
    const gltf = await new GLTFLoader().loadAsync(spark.mesh); gltf.scene.updateMatrixWorld(true);
    let sparkGeometry: THREE.BufferGeometry | undefined;
    gltf.scene.traverse(object => { if (isMesh(object) && !sparkGeometry) sparkGeometry = object.geometry.clone().applyMatrix4(object.matrixWorld); });
    disposeSceneResources(gltf.scene);
    if (!sparkGeometry) throw new Error('Synty spark geometry is missing.');
    this.particles = new ArrowRainParticles(this.renderer, this.root, map, this.ownGeometry(sparkGeometry), this.density);
    this.scene.add(this.particles.root); await this.particles.prepare();
    this.buildGroundEffects();
    const instance = await assetLibrary.loadAsset(arrowAsset);
    if (this.disposed) { instance.release(); this.release(); return; }
    this.arrowAsset = instance;
    const size = new THREE.Box3().setFromObject(instance.object).getSize(new THREE.Vector3());
    instance.object.scale.setScalar(.72 / Math.max(size.x, size.y, size.z)); instance.object.updateMatrixWorld(true);
    const count = 32;
    for (let index = 0; index < count; index++) {
      const radius = Math.sqrt(random(index, 1)) * 2.15, angle = random(index, 2) * Math.PI * 2;
      const position = this.targets[index] ? this.targets[index].clone() : new THREE.Vector3(Math.cos(angle) * radius, 0, 4.25 + Math.sin(angle) * radius);
      const object = instance.object.clone(true); object.visible = false; object.rotation.x = Math.PI / 2;
      object.traverse(mesh => { if (!isMesh(mesh)) return; const copy = (material: THREE.Material) => { const owned = material.clone(); owned.transparent = true; this.materials.add(owned); return owned; }; mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material); });
      this.root.add(object);
      this.arrows.push({ object, position, impact: ultimateSequences['arrow-rain'].release + .79 + index / count * 1.45 + random(index, 3) * .1, launch: false });
    }
    const launchArrow = instance.object.clone(true); launchArrow.visible = false; this.root.add(launchArrow);
    this.arrows.push({ object: launchArrow, position: new THREE.Vector3(), impact: ultimateSequences['arrow-rain'].release, launch: true });
    const trailMaterial = this.ownMaterial(new MeshBasicNodeMaterial({ color: '#d8b37a', transparent: true, depthWrite: false, opacity: 0 }));
    this.launchTrail = new THREE.Mesh(this.ownGeometry(new THREE.CylinderGeometry(.002, .012, 1, 6)), trailMaterial);
    this.launchTrail.visible = false; this.root.add(this.launchTrail);
    this.setQuality(this.density);
  }
  private project(material: MeshBasicNodeMaterial, center: THREE.Vector3, size: THREE.Vector3): THREE.Mesh {
    this.root.updateMatrixWorld(true); this.ground.updateMatrixWorld(true);
    const point = this.root.localToWorld(center.clone());
    const orientation = new THREE.Euler().setFromQuaternion(this.root.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))));
    const geometry = this.ownGeometry(new DecalGeometry(this.ground, point, orientation, size).applyMatrix4(this.root.matrixWorld.clone().invert()));
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) positions.setY(i, positions.getY(i) + .008);
    material.polygonOffset = true; material.polygonOffsetFactor = -2; material.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(geometry, this.ownMaterial(material)); mesh.renderOrder = 1; this.root.add(mesh); return mesh;
  }
  private buildGroundEffects(): void {
    // Geometry is clipped to the actual woodland receiver, not a floating display plane.
    const r = uv().sub(.5).mul(5.3).length();
    const worn = mx_noise_float(uv().mul(9)).mul(.07);
    const ring = smoothstep(.025, .13, r.sub(2.2).add(worn).abs()).oneMinus();
    const weathering = smoothstep(-.25, .55, mx_noise_float(uv().mul(18)));
    const rain = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    rain.colorNode = color('#463323'); rain.opacityNode = ring.mul(weathering).mul(.28).mul(this.rainOpacity);
    this.rainFootprint = this.project(rain, new THREE.Vector3(0, 0, 4.25), new THREE.Vector3(5.3, 5.3, 1));
  }
  reset(): void { this.impactEvents = []; this.targetHits = [];
    for (const entry of this.groundImpacts) { entry.mesh.removeFromParent(); this.geometries.delete(entry.mesh.geometry); entry.mesh.geometry.dispose(); const material = entry.mesh.material as MeshBasicNodeMaterial; this.materials.delete(material); material.dispose(); }
    this.groundImpacts = [];
    const puff = (time: number, position: THREE.Vector3, _index: number, _force = 1, sparks = true) => { this.impactEvents.push({ time, position: position.clone(), sparks }); };
    this.arrows.filter(a=>!a.launch && !a.disabled).forEach((arrow,index)=>puff(arrow.impact,arrow.position,index,.6,index<3 || index%4===0));
    this.targetHits = this.targets.map((position, index) => {
      const times = this.arrows.filter(a => !a.launch && !a.disabled && a.position.distanceTo(position) < .9).map(a => a.impact).sort((a, b) => a - b);
      const spaced: number[] = [];
      for (const time of times) if (!spaced.length || time - spaced[spaced.length - 1] > .28) spaced.push(time);
      return spaced.length ? spaced : [this.arrows[index].impact];
    });
    this.particles?.set(this.impactEvents);
    for (const event of this.impactEvents.filter(event => event.sparks)) {
      const shader = impact({ circleColor: new THREE.Vector4(.58, .29, .09, .3), vesicaColor: new THREE.Vector4(.85, .45, .14, .28), vesicaCount: 0, circleSizeEnd: .48, circleThickness: .025, seed: 19 }) as unknown as ImpactShader;
      const envelope = uniform(0);
      const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false }); // TSLFX's declaration exposes a raw OperatorNode; its published impact output is RGBA.
      const rgba = shader.nodes.colorNode; material.colorNode = rgba.rgb.div(rgba.a.max(.0001)); material.opacityNode = rgba.a.mul(envelope);
      const mesh = this.project(material, event.position.clone().setY(0), new THREE.Vector3(.95, .95, .7)); mesh.visible = false;
      this.groundImpacts.push({ event, mesh, shader, fade: envelope });
    }

  }
  stageMaterials(camera: THREE.Camera): void { this.particles?.stageMaterials(camera); this.groundImpacts.forEach(entry => { entry.mesh.visible = true; entry.fade.value = 0; }); if (this.launchTrail) this.launchTrail.visible = true; }
  resetParticles(): void { this.particles?.set(this.impactEvents); }
  hitTime(index: number): number { return this.targetHits[index]?.[0] ?? arrowRainSequence.pulses[0]; }
  hitTimes(index: number): readonly number[] { return this.targetHits[index] ?? []; }
  lastHit(index: number, time: number): number { let latest = Infinity; for (const hit of this.hitTimes(index)) { if (hit > time) break; latest = hit; } return latest; }
  setBowFrame(nock: THREE.Vector3, direction: THREE.Vector3, release = false): void {
    this.root.updateMatrixWorld(true);
    const position = this.root.worldToLocal(nock.clone().addScaledVector(direction, .36));
    const localDirection = direction.clone().transformDirection(this.root.matrixWorld.clone().invert());
    this.bowPosition.copy(position); this.bowDirection.copy(localDirection);
    if (release) { this.launchPosition.copy(position); this.launchDirection.copy(localDirection); }
  }
  seek(time: number, camera: THREE.Camera): void {
    if (this.disposed || !this.rainFootprint) return;
    this.root.visible=this.enabled;
    const rainAge=time-arrowRainSequence.release;
    this.rainOpacity.value=smooth(.08,.38,rainAge)*(1-smooth(.82,1.62,rainAge));
    this.root.updateMatrixWorld(true);
    if (this.particles) { this.particles.root.visible = this.enabled; this.particles.seek(time, camera); this.particles.syncCamera(); }
    for (const entry of this.groundImpacts) {
      const age = time - entry.event.time; entry.mesh.visible = age >= 0 && age < .42;
      entry.shader.uniforms.time.value = THREE.MathUtils.clamp(age / .42, 0, 1);
      entry.fade.value = smooth(0, .035, age) * (1 - smooth(.12, .42, age));
    }
    for (const arrow of this.arrows) {
      const age = time - arrow.impact;
      arrow.object.visible = !arrow.disabled && (arrow.launch ? time >= .06 && age < .43 : age >= -.43 && age < .85);
      if (!arrow.object.visible) continue;
      arrow.object.position.copy(arrow.position);
      if (arrow.launch) {
        const direction = age < 0 ? this.bowDirection : this.launchDirection;
        arrow.object.position.copy(age < 0 ? this.bowPosition : this.launchPosition).addScaledVector(direction, Math.max(0, age) * 18);
        arrow.object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      } else {
        arrow.object.position.y = .08 + Math.max(0, -age) * 17;
        arrow.object.traverse(mesh => { if (isMesh(mesh)) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.opacity = 1 - smooth(.35, .85, age); });
      }
    }
    if (this.launchTrail) {
      this.launchTrail.visible = rainAge >= 0 && rainAge < .43;
      const length = Math.min(.8, Math.max(0, rainAge * 18));
      this.launchTrail.position.copy(this.launchPosition).addScaledVector(this.launchDirection, Math.max(0, rainAge) * 18 - length / 2);
      this.launchTrail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.launchDirection);
      this.launchTrail.scale.y = length;
      this.launchTrail.material.opacity = .3 * (1 - smooth(.25, .43, rainAge));
    }
  }
  setQuality(density:number): void {
    const count=Math.max(18,Math.round(32*density));
    if (count===this.activeArrows && this.qualityApplied) return;
    this.qualityApplied=this.arrows.length>0;
    this.density=density; this.activeArrows=count;
    this.arrows.filter(a=>!a.launch).forEach((arrow,index)=> {
      arrow.disabled=index>=count;
      arrow.impact=arrowRainSequence.release+.79+index/count*1.45+random(index,3)*.1;
    });
    if (this.arrows.length) this.reset();
  }
  snapshot() {return {particles:this.particles?.snapshot(),groundImpacts:this.groundImpacts.filter(entry=>entry.mesh.visible).length,arrows:this.arrows.filter(a=>a.object.visible).length,footprint:this.rainOpacity.value};}
  begin(position: THREE.Vector3, yaw: number, ground: THREE.Mesh = this.ground): void {
    this.ground=ground; this.root.position.copy(position); this.root.rotation.y=yaw; this.root.updateMatrixWorld(true);
    if (this.rainFootprint) {this.rainFootprint.removeFromParent(); this.geometries.delete(this.rainFootprint.geometry); this.rainFootprint.geometry.dispose(); const material=this.rainFootprint.material as THREE.Material; this.materials.delete(material); material.dispose();}
    this.buildGroundEffects(); this.reset();
  }
  private release(): void { this.particles?.dispose(); disposeSceneInstances(this.root); this.root.clear(); this.arrowAsset?.release(); this.arrowAsset = undefined; this.textures.forEach(t => t.dispose()); this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.textures.clear(); this.geometries.clear(); this.materials.clear(); }
  dispose(): void { this.disposed = true; this.root.removeFromParent(); const release = () => this.release(); if (this.ready) void this.ready.then(release, release); else release(); }
}
