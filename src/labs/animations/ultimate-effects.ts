import * as THREE from 'three';
import { impact } from 'tslfx';
import { UltimateParticles, type ImpactEvent } from './ultimate-particles';
import { MeshBasicNodeMaterial, type WebGPURenderer, type Node } from 'three/webgpu';
import { color, mix, mx_noise_float, sin, smoothstep, texture, uniform, uv, vec2 } from 'three/tsl';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetLibrary, type AssetInstance } from '../../assets/asset-library';
import { isMesh, disposeSceneInstances, disposeSceneResources } from '../../assets/resource-ownership';
import { arrowAsset } from '../../gameplay/equipment';
import { particlePresets, type QualityLevel } from '../../rendering/quality-presets';

export type UltimateKind = 'crescent' | 'arrow-rain';
export const ultimateSequences = {
  crescent: { name: 'Crescent Wave', release: .42, motion: .92, duration: 3.2 },
  'arrow-rain': { name: 'Arrow Rain', release: .93, motion: 1.5, duration: 4.8 },
} as const;
export const ultimateTargets = [new THREE.Vector3(-1, 0, 3.15), new THREE.Vector3(1.1, 0, 4.1), new THREE.Vector3(-.2, 0, 5.05)];
const smooth = (a: number, b: number, value: number) => THREE.MathUtils.smoothstep(value, a, b);
const random = (index: number, salt: number) => { let n = Math.imul(index + 71, 374761393) ^ Math.imul(salt + 19, 668265263); n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
type ImpactShader = { nodes: { colorNode: Node<'vec4'> }; uniforms: { time: { value: number } } };
type GroundImpact = { event: ImpactEvent; mesh: THREE.Mesh; shader: ImpactShader; fade: { value: number } };
type RainArrow = { position: THREE.Vector3; impact: number; object: THREE.Object3D; launch: boolean };
type ArtManifest = { version: number; recipes: { id: string; emitters: { name: string; mesh: string | null; material: { texture: string | null } }[] }[] };

/** Two authored visual sequences; no combat rewards, character progress or save writes. */
export class UltimateEffects {
  readonly root = new THREE.Group();
  kind: UltimateKind = 'crescent';
  enabled = true;
  private wave = uniform(.8);
  private ribbonOpacity = uniform(0);
  private footprintOpacity = uniform(0);
  private anticipationOpacity = uniform(0);
  private targetHits: number[][] = [];
  private rainOpacity = uniform(0);
  private materials = new Set<THREE.Material>();
  private geometries = new Set<THREE.BufferGeometry>();
  private textures = new Set<THREE.Texture>();
  private groundBreak?: THREE.Texture;
  private ribbon?: THREE.Mesh<THREE.BufferGeometry, MeshBasicNodeMaterial>;
  private ribbonHalo?: THREE.Mesh<THREE.BufferGeometry, MeshBasicNodeMaterial>;
  private ribbonPosition?: THREE.BufferAttribute;
  private swordFootprint?: THREE.Mesh;
  private rainFootprint?: THREE.Mesh;
  private particles?: UltimateParticles;
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
  private disposed = false;
  private ready?: Promise<void>;
  constructor(private ground: THREE.Mesh, position: THREE.Vector3, yaw: number, quality: QualityLevel, private renderer: WebGPURenderer, private scene: THREE.Scene) {
    this.root.position.copy(position); this.root.rotation.y = yaw; this.root.updateMatrixWorld(true);
    this.root.userData.transient = true;
    this.density = particlePresets[quality].emission;
  }
  prepare(): Promise<void> {
    return this.ready ??= this.prepareArt().catch((error: unknown) => { this.release(); throw error; });
  }
  private ownGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry { this.geometries.add(geometry); return geometry; }
  private ownMaterial(material: MeshBasicNodeMaterial): MeshBasicNodeMaterial { this.materials.add(material); return material; }
  private async prepareArt(): Promise<void> {
    const response = await fetch('/vendor/synty/particle-study/recipes.json');
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
    this.particles = new UltimateParticles(this.renderer, this.root, map, this.ownGeometry(sparkGeometry), this.density);
    this.scene.add(this.particles.root); await this.particles.prepare();
    const groundBreak = (await assetLibrary.getCatalog()).assets['particle-fx:texture:textures-polygonparticles-groundbreak'];
    if (!groundBreak || groundBreak.status !== 'converted') throw new Error('Prepare the Synty ground-break texture for the Ultimate study.');
    this.groundBreak = await new THREE.TextureLoader().loadAsync(groundBreak.url); this.groundBreak.colorSpace = THREE.NoColorSpace; this.textures.add(this.groundBreak);
    this.buildGroundEffects(); this.buildRibbon();
    const instance = await assetLibrary.loadAsset(arrowAsset);
    if (this.disposed) { instance.release(); this.release(); return; }
    this.arrowAsset = instance;
    const size = new THREE.Box3().setFromObject(instance.object).getSize(new THREE.Vector3());
    instance.object.scale.setScalar(.72 / Math.max(size.x, size.y, size.z)); instance.object.updateMatrixWorld(true);
    const count = Math.max(18, Math.round(32 * this.density));
    for (let index = 0; index < count; index++) {
      const radius = Math.sqrt(random(index, 1)) * 2.15, angle = random(index, 2) * Math.PI * 2;
      const position = index < 3 ? ultimateTargets[index].clone() : new THREE.Vector3(Math.cos(angle) * radius, 0, 4.25 + Math.sin(angle) * radius);
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
    this.set('crescent');
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
    const p = uv().sub(.5).mul(7), z = p.y.negate().add(3), radius = vec2(p.x, z).length();
    const safeZ = z.max(.03);
    const cone = smoothstep(safeZ.mul(.64), safeZ.mul(.7), p.x.abs()).oneMinus().mul(smoothstep(0, .3, z));
    const reached = smoothstep(this.wave.sub(.15), this.wave.add(.08), radius).oneMinus();
    const band = smoothstep(.07, .24, radius.sub(this.wave).abs()).oneMinus();
    const grain = sin(p.x.mul(34).add(sin(z.mul(17)).mul(3))).mul(.2).add(.8);
    const brokenEarth = texture(this.groundBreak);
    const scuffs = brokenEarth.r.oneMinus().mul(brokenEarth.a);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const outline = smoothstep(.025, .08, radius.sub(5.62).abs()).oneMinus().mul(cone).add(smoothstep(.02, .075, p.x.abs().sub(safeZ.mul(.7)).abs()).oneMinus().mul(smoothstep(5.56, 5.68, radius).oneMinus()).mul(smoothstep(0, .3, z)));
    material.colorNode = mix(color('#261d15'), color('#d6aa68'), band.mul(.8).add(outline.mul(this.anticipationOpacity)));
    material.opacityNode = cone.mul(reached.mul(scuffs.pow(2)).mul(.5).add(band.mul(.55))).mul(grain).mul(this.footprintOpacity).add(outline.mul(this.anticipationOpacity));
    this.swordFootprint = this.project(material, new THREE.Vector3(0, 0, 3), new THREE.Vector3(7, 7, 1));
    const r = uv().sub(.5).mul(5.3).length();
    const worn = mx_noise_float(uv().mul(6)).mul(.025);
    const ring = smoothstep(.015, .065, r.sub(2.2).add(worn).abs()).oneMinus();
    const inner = smoothstep(1.6, 2.2, r).oneMinus().mul(.06);
    const rain = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    rain.colorNode = color('#d8b77e'); rain.opacityNode = ring.mul(.23).add(inner).mul(this.rainOpacity);
    this.rainFootprint = this.project(rain, new THREE.Vector3(0, 0, 4.25), new THREE.Vector3(5.3, 5.3, 1));
  }
  private buildRibbon(): void {
    const segments = 48, positions = new Float32Array((segments + 1) * 2 * 3), uvs = new Float32Array((segments + 1) * 2 * 2), indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      for (let j = 0; j < 2; j++) { uvs[(i * 2 + j) * 2] = i / segments; uvs[(i * 2 + j) * 2 + 1] = j; }
      if (i < segments) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geometry = this.ownGeometry(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)); geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geometry.setIndex(indices);
    this.ribbonPosition = geometry.getAttribute('position') as THREE.BufferAttribute;
    const edge = smoothstep(0, .3, uv().y).mul(smoothstep(.6, 1, uv().y).oneMinus()).mul(sin(uv().x.mul(Math.PI)).pow(.45));
    const material = this.ownMaterial(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    material.colorNode = mix(color('#bb6c31'), color('#efcb85').mul(1.15), smoothstep(.25, .6, uv().y)); material.opacityNode = edge.mul(this.ribbonOpacity);
    this.ribbon = new THREE.Mesh(geometry, material); this.ribbon.frustumCulled = false; this.root.add(this.ribbon);
    const haloMaterial = this.ownMaterial(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, color: '#bc8047', opacity: .24 }));
    haloMaterial.opacityNode = edge.mul(.24).mul(this.ribbonOpacity);
    this.ribbonHalo = new THREE.Mesh(geometry, haloMaterial); this.ribbonHalo.frustumCulled = false; this.ribbonHalo.position.y = -.07; this.root.add(this.ribbonHalo);
  }
  set(kind: UltimateKind): void {
    this.kind = kind; this.impactEvents = []; this.targetHits = [];
    for (const entry of this.groundImpacts) { entry.mesh.removeFromParent(); this.geometries.delete(entry.mesh.geometry); entry.mesh.geometry.dispose(); const material = entry.mesh.material as MeshBasicNodeMaterial; this.materials.delete(material); material.dispose(); }
    this.groundImpacts = [];
    const puff = (time: number, position: THREE.Vector3, _index: number, _force = 1, sparks = true) => { this.impactEvents.push({ time, position: position.clone(), sparks }); };
    if (kind === 'crescent') {
      for (let i = 0; i < 22; i++) {
        const distance = .9 + i / 21 * 4.65, angle = (random(i, 16) * 2 - 1) * .58;
        puff(ultimateSequences.crescent.release + (distance - .8) / 7.6, new THREE.Vector3(Math.sin(angle) * distance, .035, Math.cos(angle) * distance), i, .7, i % 3 === 0);
      }
      ultimateTargets.forEach((p, index) => puff(this.hitTime(index), p, 60 + index, 1.4));
    } else this.arrows.filter(a => !a.launch).forEach((arrow, index) => puff(arrow.impact, arrow.position, index, .6, index < 3 || index % 4 === 0));
    this.targetHits = ultimateTargets.map((position, index) => {
      if (kind === 'crescent') return [ultimateSequences.crescent.release + (position.length() - .8) / 7.6];
      const times = this.arrows.filter(a => !a.launch && a.position.distanceTo(position) < .9).map(a => a.impact).sort((a, b) => a - b);
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
  hitTime(index: number): number { return this.targetHits[index]?.[0] ?? (ultimateSequences.crescent.release + (ultimateTargets[index].length() - .8) / 7.6); }
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
    if (this.disposed || !this.ribbon || !this.ribbonHalo) return;
    this.root.visible = this.enabled;
    const sword = this.kind === 'crescent', age = time - ultimateSequences.crescent.release, radius = .8 + THREE.MathUtils.clamp(age, 0, .64) * 7.6;
    this.wave.value = radius; this.footprintOpacity.value = sword && time >= ultimateSequences.crescent.release ? 1 - smooth(1.2, 2.3, time) : 0;
    this.anticipationOpacity.value = sword ? smooth(.06, .26, time) * (1 - smooth(.36, .55, time)) * .28 : 0;
    this.swordFootprint!.visible = sword;
    const rainAge = time - ultimateSequences['arrow-rain'].release;
    this.rainFootprint!.visible = !sword; this.rainOpacity.value = !sword ? smooth(.08, .38, rainAge) * (1 - smooth(.82, 1.62, rainAge)) : 0;
    this.ribbon.visible = this.ribbonHalo.visible = sword && age >= 0 && age < .72;
    if (this.ribbon.visible) {
      const alpha = (1 - smooth(.48, .72, age)) * smooth(0, .04, age);
      this.ribbonOpacity.value = alpha;
      const positions = this.ribbonPosition!;
      for (let i = 0; i <= 48; i++) for (let j = 0; j < 2; j++) {
        const angle = -.61 + i / 48 * 1.22, r = radius + (j - .5) * .22;
        positions.setXYZ(i * 2 + j, Math.sin(angle) * r, .08 + Math.sin(i / 48 * Math.PI) * .1, Math.cos(angle) * r);
      }
      positions.needsUpdate = true;
    }
    this.root.updateMatrixWorld(true);
    if (this.particles) { this.particles.root.visible = this.enabled; this.particles.seek(time, camera); this.particles.syncCamera(); }
    for (const entry of this.groundImpacts) {
      const age = time - entry.event.time; entry.mesh.visible = age >= 0 && age < .42;
      entry.shader.uniforms.time.value = THREE.MathUtils.clamp(age / .42, 0, 1);
      entry.fade.value = smooth(0, .035, age) * (1 - smooth(.12, .42, age));
    }
    for (const arrow of this.arrows) {
      const age = time - arrow.impact;
      arrow.object.visible = !sword && (arrow.launch ? time >= .06 && age < .43 : age >= -.43 && age < .85);
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
      this.launchTrail.visible = !sword && rainAge >= 0 && rainAge < .43;
      const length = Math.min(.8, Math.max(0, rainAge * 18));
      this.launchTrail.position.copy(this.launchPosition).addScaledVector(this.launchDirection, Math.max(0, rainAge) * 18 - length / 2);
      this.launchTrail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.launchDirection);
      this.launchTrail.scale.y = length;
      this.launchTrail.material.opacity = .3 * (1 - smooth(.25, .43, rainAge));
    }
  }
  snapshot() { return { kind: this.kind, particles: this.particles?.snapshot(), groundEngine: 'tslfx 0.6.0', groundImpacts: this.groundImpacts.filter(entry => entry.mesh.visible).length, arrows: this.arrows.filter(a => a.object.visible).length, wave: this.wave.value, anticipation: this.anticipationOpacity.value, footprint: this.kind === 'crescent' ? this.footprintOpacity.value : this.rainOpacity.value }; }
  private release(): void { this.particles?.dispose(); disposeSceneInstances(this.root); this.root.clear(); this.arrowAsset?.release(); this.arrowAsset = undefined; this.textures.forEach(t => t.dispose()); this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.textures.clear(); this.geometries.clear(); this.materials.clear(); }
  dispose(): void { this.disposed = true; this.root.removeFromParent(); const release = () => this.release(); if (this.ready) void this.ready.then(release, release); else release(); }
}
