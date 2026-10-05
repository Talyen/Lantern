import { expect, test } from 'vitest';
import * as THREE from 'three';
import { LocalShadows } from '../src/rendering/local-shadows';
import { includeCutawayShadows, lightingOnly } from '../src/rendering/cutaway';

function fixture() {
  const scene = new THREE.Scene(), light = new THREE.PointLight('white', 12, 8);
  light.castShadow = true; includeCutawayShadows(light); scene.add(light);
  const parent = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.castShadow = true; parent.add(mesh); scene.add(parent);
  const shadows = new LocalShadows();
  const update = () => { light.shadow.needsUpdate = false; shadows.update(scene, [light], false); return light.shadow.needsUpdate; };
  shadows.update(scene, [light], false);
  return { scene, light, parent, mesh, shadows, update };
}

// Admission: cached shadows can otherwise retain a removed actor/tree forever;
// skinning, hidden ancestors and cutaway layers are not covered by static checks.
test('cached flame depth survives brightness changes but clears departed and hidden casters', () => {
  const f = fixture();
  expect(f.update()).toBe(false);
  f.light.intensity *= .9; expect(f.update()).toBe(false);
  f.mesh.position.x = 20; expect(f.update()).toBe(true);
  expect(f.update()).toBe(false);
  f.mesh.position.x = 0; expect(f.update()).toBe(true);
  f.parent.visible = false; expect(f.update()).toBe(true);
  expect(f.shadows.diagnostics()[0].casters).toBe(0);
  f.parent.visible = true; expect(f.update()).toBe(true);
  f.scene.remove(f.parent); expect(f.update()).toBe(true);
  expect(f.update()).toBe(false);
});

test('cutaway geometry and instance changes invalidate flame shadows without depending on beauty visibility', () => {
  const f = fixture(); lightingOnly(f.mesh); expect(f.update()).toBe(true);
  expect(f.shadows.diagnostics()[0].casters).toBe(1);
  const instances = new THREE.InstancedMesh(f.mesh.geometry, f.mesh.material, 1); instances.castShadow = true;
  f.scene.add(instances); expect(f.update()).toBe(true); expect(f.update()).toBe(false);
  instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(20, 0, 0)); instances.instanceMatrix.needsUpdate = true;
  expect(f.update()).toBe(true); expect(f.update()).toBe(false);
  f.mesh.material.visible = false; expect(f.update()).toBe(true);
  expect(f.shadows.diagnostics()[0].casters).toBe(0);
});

test('a paused skinned pose reaching into the light invalidates cached depth', () => {
  const f = fixture(); f.scene.remove(f.parent);
  const geometry = new THREE.BoxGeometry();
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4); for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const skin = new THREE.SkinnedMesh(geometry, f.mesh.material), bone = new THREE.Bone();
  skin.add(bone); skin.bind(new THREE.Skeleton([bone])); skin.castShadow = true; skin.position.x = 20; f.scene.add(skin);
  f.shadows.update(f.scene, [f.light], true); f.light.shadow.needsUpdate = false;
  bone.position.x = -20; f.shadows.update(f.scene, [f.light], true);
  expect(f.light.shadow.needsUpdate).toBe(true);
  expect(f.shadows.diagnostics()[0].casters).toBe(1);
});
