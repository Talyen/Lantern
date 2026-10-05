import * as THREE from 'three';
import { assetLibrary, type AssetInstance } from '../assets/asset-library';
import { isMesh } from '../assets/resource-ownership';
import { generateGrass, grassMask, grassCellSize, grassClearance, isGrassPlacement, type GrassFootprints } from '../levels/grass';
import type { AreaDefinition, Placement } from '../levels/types';
import { waterBankWetness } from '../levels/water';
import type { Vegetation } from './vegetation';

type Prototype = { bounds: THREE.Box3; meshes: THREE.Mesh[]; radiusPerHeight: number; height: number };

/** One borrowed source per botanical type; only cell instance buffers belong to the area. */
export async function createGrass(area: AreaDefinition, vegetation: Vegetation) {
  const root = new THREE.Group(); root.name = 'grass-clumps'; root.userData.transient = true;
  const patches = area.grass ?? [], wetBanks = area.effects.water.length > 0;
  const mask = patches.length || wetBanks ? grassMask(area, patches) : null;
  let coverageData = mask?.data;
  if (mask && wetBanks) {
    coverageData = new Uint8Array(mask.data.length * 2);
    for (let z = 0; z < mask.resolution; z++) for (let x = 0; x < mask.resolution; x++) {
      const i = z * mask.resolution + x;
      coverageData[i * 2] = mask.data[i];
      coverageData[i * 2 + 1] = Math.round(waterBankWetness(area.effects.water,
        mask.min[0] + (x + .5) / mask.resolution * mask.span[0], mask.min[1] + (z + .5) / mask.resolution * mask.span[1]) * 255);
    }
  }
  const coverageTexture = mask && coverageData ? new THREE.DataTexture(coverageData, mask.resolution, mask.resolution, wetBanks ? THREE.RGFormat : THREE.RedFormat) : null;
  if (coverageTexture) { coverageTexture.minFilter = coverageTexture.magFilter = THREE.LinearFilter; coverageTexture.needsUpdate = true; }
  const coverage = mask && coverageTexture ? { texture: coverageTexture, min: mask.min, span: mask.span, wetBanks } : null;
  const leases: AssetInstance[] = [];
  const prototypes = new Map<string, Prototype>(), meshes: THREE.InstancedMesh[] = [], missing: string[] = [];
  let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true;
    root.removeFromParent(); meshes.forEach(mesh => mesh.dispose());
    leases.forEach(instance => instance.release()); coverageTexture?.dispose();
  }
  try {
    const ids = [...new Set((area.grassVariants ?? []).map(v => v.asset.libraryId))];
    const loaded = await Promise.allSettled(ids.map(id => assetLibrary.loadAsset(id, { shadows: false })));
    leases.push(...loaded.flatMap(result => result.status === 'fulfilled' ? [result.value] : []));
    for (let i = 0; i < loaded.length; i++) {
      const result = loaded[i];
      if (result.status === 'rejected') { missing.push(`grass:${ids[i]}`); continue; }
      const instance = result.value, sourceMeshes: THREE.Mesh[] = [];
      instance.object.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(instance.object), size = bounds.getSize(new THREE.Vector3());
      instance.object.traverse(object => { if (isMesh(object)) sourceMeshes.push(object); });
      if (size.y <= 0 || !sourceMeshes.length || sourceMeshes.some(mesh => mesh instanceof THREE.SkinnedMesh || (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(m => m.transparent))) {
        instance.release(); missing.push(`grass:${ids[i]}: requires opaque static geometry`); continue;
      }
      const radiusPerHeight = Math.hypot(size.x, size.z) / (2 * size.y);
      prototypes.set(ids[i], { bounds, meshes: sourceMeshes, radiusPerHeight, height: size.y });
    }
    const footprints: GrassFootprints = prototypes;
    const manual = area.props.filter(p => isGrassPlacement(area, p));
    const terrain = area.props.find(p => p.terrain && p.primitive?.kind === 'box');
    const groundY = terrain ? terrain.position[1] + terrain.primitive!.size[1] * terrain.scale[1] / 2 : 0;
    const generated = generateGrass(area, footprints);
    const placements = [...generated, ...manual], manualIds = new Set(manual.map(p => p.id));
    const cells = new Map<string, Placement[]>();
    for (const placement of placements) {
      const id = (placement.asset as { libraryId: string }).libraryId, prototype = prototypes.get(id);
      if (!prototype) continue;
      const radius = prototype.radiusPerHeight * (placement.height ?? prototype.height) * Math.max(placement.scale[0], placement.scale[2]);
      if (manualIds.has(placement.id) && grassClearance(area, placement.position[0], placement.position[2], radius) === 0) {
        missing.push(`grass:${placement.id}: footprint intersects protected ground`); continue;
      }
      const key = `${id}/${Math.floor(placement.position[0] / grassCellSize)},${Math.floor(placement.position[2] / grassCellSize)}`;
      const cell = cells.get(key) ?? []; cell.push(placement); cells.set(key, cell);
    }
    let triangles = 0, clumps = 0;
    const placementMatrix = new THREE.Matrix4(), normalization = new THREE.Matrix4(), transform = new THREE.Object3D();
    for (const [key, cell] of cells) {
      const prototype = prototypes.get((cell[0].asset as { libraryId: string }).libraryId)!;
      const center = prototype.bounds.getCenter(new THREE.Vector3());
      const x = (Math.floor(cell[0].position[0] / grassCellSize) + .5) * grassCellSize;
      const z = (Math.floor(cell[0].position[2] / grassCellSize) + .5) * grassCellSize;
      for (const source of prototype.meshes) {
        const mesh = new THREE.InstancedMesh(source.geometry, source.material, cell.length);
        mesh.name = `grass-cell:${key}`; mesh.position.set(x, 0, z);
        mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.transient = true; mesh.userData.ids = cell.map(p => p.id);
        for (let i = 0; i < cell.length; i++) {
          const p = cell[i], scale = (p.height ?? prototype.height) / prototype.height;
          normalization.makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -prototype.bounds.min.y, -center.z));
          transform.position.set(p.position[0] - x, (manualIds.has(p.id) ? p.position[1] : groundY) - .004, p.position[2] - z);
          transform.rotation.set(0, p.yaw, 0); transform.scale.fromArray(p.scale); transform.updateMatrix();
          placementMatrix.copy(transform.matrix).multiply(normalization).multiply(source.matrixWorld);
          mesh.setMatrixAt(i, placementMatrix);
        }
        mesh.computeBoundingBox(); mesh.computeBoundingSphere(); root.add(mesh); meshes.push(mesh);
        vegetation.describeInstances(mesh, 'soft', true);
        triangles += (source.geometry.index?.count ?? source.geometry.getAttribute('position').count) / 3 * cell.length;
      }
      clumps += cell.length;
    }
    const stats = { clumps, generated: generated.length, manual: manual.length, cells: cells.size, draws: meshes.length, triangles, assets: ids };
    root.userData.grass = stats;
    return { root, coverage, missing, stats, dispose };
  } catch (error) { dispose(); throw error; }
}
