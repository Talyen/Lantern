import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { uv, uniform, vec3, sin, atan, mix, smoothstep } from 'three/tsl';

export type PortalDefinition = { id: string; position: [number, number, number]; yaw: number; width: number; height: number };
/** Generic visual only: no destination, travel, combat or save behavior. */
export class Portal {
  readonly root = new THREE.Group();
  private readonly clock = uniform(0);
  private readonly rune: THREE.CanvasTexture;
  private time = 0;
  private disposed = false;
  constructor(definition: PortalDefinition, parent: THREE.Object3D) {
    this.root.name = definition.id; this.root.position.fromArray(definition.position); this.root.rotation.y = definition.yaw;
    const point = uv().sub(.5).mul(2), radius = point.length();
    const swirl = sin(atan(point.y, point.x).mul(3).add(radius.mul(13)).sub(this.clock.mul(1.8))).mul(.5).add(.5);
    const wisps = swirl.mul(sin(radius.mul(23).sub(this.clock.mul(2.1))).mul(.25).add(.5));
    const energy = wisps;
    const interior = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    interior.colorNode = mix(vec3(.025, .014, .006), vec3(1.5, .65, .13), energy.mul(.7).add(smoothstep(.78, .98, radius).mul(.3)));
    interior.opacityNode = smoothstep(.94, 1, radius).oneMinus().mul(.92);
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(definition.width, definition.height), interior);
    surface.position.y = definition.height / 2; this.root.add(surface);
    const rimMaterial = new MeshBasicNodeMaterial({ color: new THREE.Color(2.2, 1.15, .3) });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, .025, 8, 80), rimMaterial);
    rim.scale.set(definition.width / 2, definition.height / 2, 1); rim.position.y = definition.height / 2; this.root.add(rim);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!; ctx.strokeStyle = '#ffc475'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(64,64,48,0,Math.PI*2); ctx.arc(64,64,40,0,Math.PI*2); ctx.stroke();
    for (let i=0;i<12;i++) { const angle=i/12*Math.PI*2; ctx.beginPath(); ctx.moveTo(64+Math.cos(angle)*32,64+Math.sin(angle)*32); ctx.lineTo(64+Math.cos(angle)*40,64+Math.sin(angle)*40); ctx.stroke(); }
    this.rune = new THREE.CanvasTexture(canvas); this.rune.colorSpace = THREE.SRGBColorSpace;
    const receiver = new THREE.Mesh(new THREE.PlaneGeometry(3,3)); receiver.rotation.x=-Math.PI/2; receiver.updateMatrixWorld(true);
    const decal = new THREE.Mesh(new DecalGeometry(receiver, new THREE.Vector3(0,.015,0), new THREE.Euler(-Math.PI/2,0,0), new THREE.Vector3(2,2,.1)), new MeshBasicNodeMaterial({ map:this.rune, transparent:true, opacity:.35, depthWrite:false }));
    receiver.geometry.dispose(); (receiver.material as THREE.Material).dispose(); this.root.add(decal);
    parent.add(this.root);
  }
  update(dt: number): void {
    if (this.disposed || !this.root.visible) return;
    this.time += dt; this.clock.value = this.time;
  }
  reset(): void { this.time = 0; this.clock.value = 0; }

  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.root.removeFromParent(); this.rune.dispose();
    this.root.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
  }
}
