import * as THREE from 'three';
export type MaterialIssue = { material: string; message: string };
/** Validate the coordinates actually sampled, ignoring zero-area exporter triangles. */
export function validateMaterial(material: THREE.MeshStandardMaterial, geometry: THREE.BufferGeometry, prepared = false): MaterialIssue[] {
  const issues: MaterialIssue[] = [];
  const fail = (message: string) => issues.push({ material: material.name || '(unnamed)', message });
  if (prepared) for (const key of ['map', 'normalMap', 'roughnessMap'] as const) if (!material[key]) fail(`missing ${key}`);
  if (![material.normalScale.x, material.normalScale.y].every(Number.isFinite)) fail('invalid normal strength');
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
    const map = material[key]; if (!map) continue;
    if (map.matrixAutoUpdate) map.updateMatrix();
    if (material.map?.matrixAutoUpdate) material.map.updateMatrix();
    const expected = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (map.colorSpace !== expected) fail(`${key} has incorrect color space`);
    const uv = geometry.getAttribute(map.channel === 0 ? 'uv' : `uv${map.channel}`);
    if (!uv || uv.itemSize !== 2) { fail(`${key} requires UV channel ${map.channel}`); continue; }
    const position = geometry.getAttribute('position'), index = geometry.index;
    if (!position) continue;
    let faces = 0, covered = 0;
    for (let i = 0; i + 2 < (index?.count ?? position.count); i += 3) {
      const indices = [0, 1, 2].map(offset => index ? index.getX(i + offset) : i + offset);
      const [a, b, c] = indices.map(vertex => new THREE.Vector3().fromBufferAttribute(position, vertex));
      if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq() < 1e-16) continue;
      faces++;
      const [p, q, r] = indices.map(vertex => [uv.getX(vertex), uv.getY(vertex)]);
      if ([...p, ...q, ...r].every(Number.isFinite) && Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) > 1e-12) covered++;
    }
    if (faces && covered !== faces && (prepared || key === 'normalMap')) fail(`${key} has collapsed/non-finite UVs on ${faces - covered}/${faces} visible triangles`);
    if (prepared && material.map && (map.channel !== material.map.channel || !map.matrix.equals(material.map.matrix))) fail(`${key} does not share the color/height coordinate frame`);
    if (prepared && material.map) {
      const a = map.image as { width?: number; height?: number } | undefined, b = material.map.image as { width?: number; height?: number } | undefined;
      if (a?.width && b?.width && (a.width !== b.width || a.height !== b.height)) fail(`${key} has mismatched atlas dimensions`);
    }
  }
  const tangent = geometry.getAttribute('tangent');
  if (tangent && (tangent.itemSize !== 4 || tangent.count !== geometry.getAttribute('position')?.count)) fail('invalid tangent layout');
  if (tangent) for (let i = 0; i < tangent.count; i++) {
    if (![tangent.getX(i), tangent.getY(i), tangent.getZ(i), tangent.getW(i)].every(Number.isFinite) || Math.abs(Math.abs(tangent.getW(i)) - 1) > .001) { fail('invalid tangent values/handedness'); break; }
  }
  return issues;
}
