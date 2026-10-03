import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, cos, cross, float, Fn, mix, modelWorldMatrix, modelWorldMatrixInverse, normalLocal, positionLocal, positionPrevious, sin, uniform, vec3, vec4 } from 'three/tsl';
import { generateGrass, grassMask, grassCellSize, type GrassBlade, type GrassPatch } from '../levels/grass';
import type { AreaDefinition } from '../levels/types';
import type { Vegetation } from './vegetation';

/** Shared across carpet cells; advanced by the area's existing paused effects clock. */
export function createGrass(area: AreaDefinition, patches: GrassPatch[], vegetation: Vegetation) {
  const root = new THREE.Group(); root.name = 'grass-carpets'; root.userData.transient = true;
  const mask = patches.length ? grassMask(area, patches) : null;
  const coverageTexture = mask ? new THREE.DataTexture(mask.data, mask.resolution, mask.resolution, THREE.RedFormat) : null;
  if (coverageTexture) { coverageTexture.minFilter = coverageTexture.magFilter = THREE.LinearFilter; coverageTexture.needsUpdate = true; }
  const coverage = mask && coverageTexture ? { texture: coverageTexture, min: mask.min, span: mask.span } : null;
  const clock = uniform(0), previousClock = uniform(0), wind = uniform(new THREE.Vector3(.08, 0, .035)), previousWind = uniform(new THREE.Vector3(.08, 0, .035));
  const bladeT = attribute('bladeT', 'float'), origin = attribute('grassOrigin', 'vec3'), world = attribute('grassWorld', 'vec2'), shape = attribute('grassShape', 'vec3'), blade = attribute('grassBlade', 'vec2');
  const bend = attribute('grassBend', 'vec3');
  const anchor = bladeT.mul(bladeT);
  const wave = (time: typeof clock) => sin(world.x.mul(.55).add(world.y.mul(.32)).sub(time.mul(.8))).mul(.65)
    .add(sin(world.y.mul(.91).sub(world.x.mul(.23)).sub(time.mul(.4))).mul(.25))
    .add(sin(time.mul(1.1).add(shape.y)).mul(.1));
  const material = new MeshStandardNodeMaterial({ roughness: .95, side: THREE.DoubleSide, vertexColors: false });
  // Explicit geometry-owned attributes avoid r186's pass-local instance-matrix
  // buffers and let every area replacement release the complete carpet allocation.
  material.positionNode = Fn(() => {
    const c = cos(blade.y), s = sin(blade.y);
    const taper = bladeT.oneMinus().pow(bend.z);
    const taperSlope = bladeT.oneMinus().max(.02).pow(bend.z.sub(1)).mul(bend.z).negate();
    const scaled = vec3(positionLocal.x.mul(blade.x).mul(taper).add(anchor.mul(bend.x).mul(shape.x)),
      bladeT.mul(shape.x), positionLocal.z.mul(blade.x).mul(taper).add(anchor.mul(bend.y).mul(shape.x)));
    const rotate = (v: typeof scaled) => vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
    const point = rotate(scaled).add(origin).toVar();
    const sway = wind.mul(shape.x).mul(wave(clock)).mul(1.5);
    const root = modelWorldMatrix.mul(vec4(origin, 1)).xyz;
    const push = modelWorldMatrixInverse.mul(vec4(vegetation.influence(root, float(0)).mul(shape.x).mul(.45), 0)).xyz;
    const oldPush = modelWorldMatrixInverse.mul(vec4(vegetation.influence(root, float(0), true).mul(shape.x).mul(.45), 0)).xyz;
    // Tangents follow taper, authored bend and current sway; folds stay lit as
    // narrow ribbons rather than broad flat triangles, even while moving.
    const across = vec3(1, 0, positionLocal.x.sign().mul(-.07));
    const along = vec3(positionLocal.x.mul(blade.x).mul(taperSlope).add(bladeT.mul(2).mul(bend.x).mul(shape.x)),
      shape.x, positionLocal.z.mul(blade.x).mul(taperSlope).add(bladeT.mul(2).mul(bend.y).mul(shape.x)));
    normalLocal.assign(cross(rotate(across), rotate(along).add(sway.add(push).mul(bladeT).mul(2))).normalize());
    positionPrevious.assign(point.add(previousWind.mul(shape.x).mul(anchor).mul(wave(previousClock)).mul(1.5)).add(oldPush.mul(anchor)));
    return point.add(sway.add(push).mul(anchor));
  })();
  const rootColor = vec3(...new THREE.Color('#303624').toArray());
  const green = vec3(...new THREE.Color('#576044').toArray()), straw = vec3(...new THREE.Color('#827653').toArray());
  material.colorNode = mix(rootColor, mix(green, straw, shape.z), bladeT.smoothstep(.08, .92));
  const positions: number[] = [], heights: number[] = [], indices: number[] = [];
  const segments = 4;
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    for (let col = 0; col < 3; col++) {
      positions.push((col - 1) * .5, t, col === 1 ? .035 : 0);
      // A shallow fold gives each narrow ribbon two faces rather than one broad flat wedge.
      heights.push(t);
    }
  }
  for (let row = 0; row < segments; row++) for (let col = 0; col < 2; col++) {
    const a = row * 3 + col, b = a + 3; indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // Every cell uses the same immutable blade topology. Cell-specific instance
  // attributes and bounds stay independent; the whole carpet retires together.
  const bladeGeometry = new THREE.BufferGeometry();
  bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bladeGeometry.setAttribute('bladeT', new THREE.Float32BufferAttribute(heights, 1));
  bladeGeometry.setIndex(indices); bladeGeometry.computeVertexNormals();
  const terrain = area.props.find(p => p.terrain && p.primitive?.kind === 'box');
  const groundY = terrain ? terrain.position[1] + terrain.primitive!.size[1] * terrain.scale[1] / 2 : 0;
  const blades = generateGrass(area, patches), cells = new Map<string, GrassBlade[]>();
  for (const blade of blades) {
    const key = `${Math.floor(blade.x / grassCellSize)},${Math.floor(blade.z / grassCellSize)}`;
    const cell = cells.get(key) ?? []; cell.push(blade); cells.set(key, cell);
  }
  const geometry: THREE.InstancedBufferGeometry[] = [], meshes: THREE.Mesh[] = [];
  const boundPoint = new THREE.Vector3();
  for (const [key, cell] of cells) {
    const [cx, cz] = key.split(',').map(Number), x = (cx + .5) * grassCellSize, z = (cz + .5) * grassCellSize;
    const g = new THREE.InstancedBufferGeometry(); g.instanceCount = cell.length;
    g.setAttribute('position', bladeGeometry.getAttribute('position'));
    g.setAttribute('bladeT', bladeGeometry.getAttribute('bladeT'));
    g.setAttribute('normal', bladeGeometry.getAttribute('normal'));
    g.setIndex(bladeGeometry.index);
    const origins = new Float32Array(cell.length * 3), shapes = new Float32Array(cell.length * 3), worlds = new Float32Array(cell.length * 2), blades = new Float32Array(cell.length * 2), bends = new Float32Array(cell.length * 3);
    const mesh = new THREE.Mesh(g, material); mesh.name = `grass-cell-${key}`; mesh.position.set(x, 0, z); mesh.receiveShadow = true; mesh.castShadow = false;
    // Cells keep fixed local placement; wind deforms vertices in the shared
    // material. World matrices still follow any movement of the carpet/area.
    mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
    const box = new THREE.Box3();
    cell.forEach((blade, i) => {
      // Root height follows the authored flat terrain; bury roots slightly to avoid floating blades.
      const xyz = i * 3, xy = i * 2;
      origins[xyz] = blade.x - x; origins[xyz + 1] = groundY - .004; origins[xyz + 2] = blade.z - z;
      worlds[xy] = blade.x; worlds[xy + 1] = blade.z; blades[xy] = blade.width; blades[xy + 1] = blade.yaw;
      box.expandByPoint(boundPoint.set(blade.x - x, groundY - .004, blade.z - z));
      box.expandByPoint(boundPoint.set(blade.x - x, groundY + blade.height, blade.z - z));
      bends[xyz] = blade.lean[0]; bends[xyz + 1] = blade.lean[1]; bends[xyz + 2] = blade.taper;
      shapes[xyz] = blade.height; shapes[xyz + 1] = blade.phase; shapes[xyz + 2] = blade.shade;
    });
    g.setAttribute('grassOrigin', new THREE.InstancedBufferAttribute(origins, 3));
    g.setAttribute('grassShape', new THREE.InstancedBufferAttribute(shapes, 3));
    g.setAttribute('grassWorld', new THREE.InstancedBufferAttribute(worlds, 2));
    g.setAttribute('grassBlade', new THREE.InstancedBufferAttribute(blades, 2));
    g.setAttribute('grassBend', new THREE.InstancedBufferAttribute(bends, 3));
    const maxHeight = Math.max(...cell.map(blade => blade.height));
    g.boundingBox = box.expandByScalar(.32 + maxHeight * .45); g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    geometry.push(g); meshes.push(mesh); root.add(mesh);
  }
  root.userData.grass = { blades: blades.length, cells: cells.size };
  let disposed = false;
  return { root, coverage, update(time: number, direction: THREE.Vector3) { previousClock.value = clock.value; previousWind.value.copy(wind.value); clock.value = time; wind.value.copy(direction); }, dispose() { if (disposed) return; disposed = true; root.removeFromParent(); meshes.forEach(mesh => mesh.dispose()); geometry.forEach(g => g.dispose()); material.dispose(); coverageTexture?.dispose(); } };
}
export type GrassCarpets = ReturnType<typeof createGrass>;
