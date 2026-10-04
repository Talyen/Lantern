import * as THREE from 'three';
import { streamSection, waterDepth, waterHeight, type WaterDefinition } from '../levels/water';
import type { Placement } from '../levels/types';

/** Carve static visual ground with a shallow bed. Traversal remains the authored flat ford. */
export function streamTerrain(placement: Placement, waters: readonly WaterDefinition[]): THREE.BufferGeometry | undefined {
  const streams = waters.filter(water => water.channel);
  if (!streams.length || placement.primitive?.kind !== 'box') return undefined;
  const [width, height, length] = placement.primitive.size;
  const transform = new THREE.Matrix4().compose(new THREE.Vector3(...placement.position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw), new THREE.Vector3(...placement.scale));
  const inverse = transform.clone().invert(), point = new THREE.Vector3();
  const top = placement.position[1] + height * placement.scale[1] / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -length / 2); shape.lineTo(width / 2, -length / 2);
  shape.lineTo(width / 2, length / 2); shape.lineTo(-width / 2, length / 2); shape.closePath();
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [];
  const append = (x: number, y: number, z: number) => {
    point.set(x, y, z).applyMatrix4(inverse); positions.push(point.x, point.y, point.z); uvs.push(point.x / width + .5, point.z / length + .5);
  };
  const steps = 112;
  for (const water of streams) {
    const channel = water.channel!, bank = channel.bankWidth ?? .65, yaw = water.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
    const world = (x: number, z: number) => [water.position[0] + x * c + z * s, water.position[1] - x * s + z * c] as const;
    const edge: THREE.Vector2[] = [];
    for (const side of [-1, 1]) for (let j = 0; j <= steps; j++) {
      const x = ((side === -1 ? j : steps - j) / steps - .5) * water.width, section = streamSection(channel, x);
      const [wx, wz] = world(x, section.z + side * (section.width / 2 + bank));
      point.set(wx, top, wz).applyMatrix4(inverse);
      if (Math.abs(point.x) >= width / 2 || Math.abs(point.z) >= length / 2) return undefined;
      edge.push(new THREE.Vector2(point.x, -point.z));
    }
    const hole = new THREE.Path(edge); hole.closePath(); shape.holes.push(hole);
    const base = positions.length / 3, bands = [-1, -.82, -.58, -.27, 0, .27, .58, .82, 1];
    for (let j = 0; j <= steps; j++) {
      const x = (j / steps - .5) * water.width, section = streamSection(channel, x), half = section.width / 2 + bank;
      for (const band of bands) {
        const z = section.z + band * half, side = Math.abs(band * half) / (section.width / 2);
        let y: number;
        if (side <= 1) y = waterHeight - waterDepth(water, x * 2 / water.width, z * 2 / water.length);
        else {
          const t = Math.min(1, (side - 1) * section.width / 2 / bank);
          y = THREE.MathUtils.lerp(waterHeight - .025, top, t) + Math.sin(t * Math.PI) * .055;
        }
        // Blend the off-stage end caps into the ground, outside the playable view.
        const end = Math.max(0, Math.min(1, (water.width / 2 - Math.abs(x)) / .7));
        y = THREE.MathUtils.lerp(top, y, end);
        const [wx, wz] = world(x, z); append(wx, y, wz);
      }
    }
    for (let j = 0; j < steps; j++) for (let b = 0; b < bands.length - 1; b++) {
      const a = base + j * bands.length + b, next = a + bands.length;
      indices.push(a, a + 1, next, a + 1, next + 1, next);
    }
  }
  const flat = new THREE.ShapeGeometry(shape); flat.rotateX(-Math.PI / 2); flat.translate(0, height / 2, 0);
  const start = positions.length / 3, p = flat.getAttribute('position'), uv = flat.getAttribute('uv');
  for (let i = 0; i < p.count; i++) { positions.push(p.getX(i), p.getY(i), p.getZ(i)); uvs.push(uv.getX(i), uv.getY(i)); }
  for (const index of flat.index!.array) indices.push(start + index); flat.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
