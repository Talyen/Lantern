import * as THREE from 'three';
import { streamSection, waterDepth, waterLevel, type WaterDefinition } from './water';
import type { Placement, AreaDefinition } from './types';
import type { Surface } from '../gameplay/movement';

/** Carve static visual ground with a shallow bed. Traversal remains the authored flat ford. */
export function waterTerrain(placement: Placement, waters: readonly WaterDefinition[]): THREE.BufferGeometry | undefined {
  const streams = waters;
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
    const bank = water.channel?.bankWidth ?? (water.preset === 'puddle' ? .15 : .65), yaw = water.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
    const world = (x: number, z: number) => [water.position[0] + x * c + z * s, water.position[1] - x * s + z * c] as const;
    if (!water.channel) {
      const sourceRing = water.boundary ?? Array.from({ length: 64 }, (_, i) => [Math.cos(i / 64 * Math.PI * 2), Math.sin(i / 64 * Math.PI * 2)]);
      const signedArea = sourceRing.reduce((sum, p, i) => { const q = sourceRing[(i + 1) % sourceRing.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
      const ring = signedArea < 0 ? [...sourceRing].reverse() : sourceRing;
      const outer = ring.map(([u, v]) => { const x = u * water.width / 2, z = v * water.length / 2, length = Math.hypot(x, z); return [x * (1 + bank / length), z * (1 + bank / length)]; });
      const edge = outer.map(([x, z]) => { const [wx, wz] = world(x, z); point.set(wx, top, wz).applyMatrix4(inverse); return new THREE.Vector2(point.x, -point.z); });
      if (edge.some(p => Math.abs(p.x) >= width / 2 || Math.abs(p.y) >= length / 2)) return undefined;
      const hole = new THREE.Path(edge); hole.closePath(); shape.holes.push(hole);
      const base = positions.length / 3, bands = [0, .25, .5, .75, 1, 1.25, 1.5];
      for (const band of bands) for (let i = 0; i < ring.length; i++) {
        const [u, v] = ring[i], x = u * water.width / 2, z = v * water.length / 2;
        const t = Math.max(0, Math.min(1, (band - 1) * 2));
        const px = band <= 1 ? x * band : THREE.MathUtils.lerp(x, outer[i][0], t);
        const pz = band <= 1 ? z * band : THREE.MathUtils.lerp(z, outer[i][1], t);
        const y = band <= 1 ? waterLevel(water) - waterDepth(water, u * band, v * band) : THREE.MathUtils.lerp(waterLevel(water), top, t) + Math.sin(t * Math.PI) * (water.preset === 'puddle' ? .005 : .045);
        const [wx, wz] = world(px, pz); append(wx, y, wz);
      }
      for (let band = 0; band < bands.length - 1; band++) for (let i = 0; i < ring.length; i++) {
        const a = base + band * ring.length + i, b = base + band * ring.length + (i + 1) % ring.length, n = a + ring.length, m = b + ring.length;
        indices.push(a, b, n, b, m, n);
      }
      continue;
    }
    const channel = water.channel;
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
        if (side <= 1) y = waterLevel(water) - waterDepth(water, x * 2 / water.width, z * 2 / water.length);
        else {
          const t = Math.min(1, (side - 1) * section.width / 2 / bank);
          y = THREE.MathUtils.lerp(waterLevel(water) - .025, top, t) + Math.sin(t * Math.PI) * .055;
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

/** The same bed/banks become collision and navigation ground, clipped to the playable boundary. */
export function waterGround(area: AreaDefinition): Surface | undefined {
  const terrain = area.props.find(p => p.terrain && p.primitive?.kind === 'box');
  if (!terrain) return undefined;
  const geometry = waterTerrain(terrain, area.effects.water);
  if (!geometry) return undefined;
  geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...terrain.position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), terrain.yaw), new THREE.Vector3(...terrain.scale)));
  const boundary = area.layout.boundary;
  const outline = boundary.kind === 'polygon' ? boundary.points : Array.from({ length: 64 }, (_, i) =>
    [boundary.center[0] + Math.cos(i / 64 * Math.PI * 2) * boundary.radius, boundary.center[1] + Math.sin(i / 64 * Math.PI * 2) * boundary.radius]);
  const result: Surface = { positions: [], indices: [] }, vertices = geometry.getAttribute('position'), indices = geometry.index!.array;
  for (let t = 0; t < indices.length; t += 3) {
    let polygon = [0, 1, 2].map(c => new THREE.Vector3(vertices.getX(indices[t + c]), vertices.getY(indices[t + c]), vertices.getZ(indices[t + c])));
    for (let edge = 0; edge < outline.length && polygon.length; edge++) {
      const a = outline[edge], b = outline[(edge + 1) % outline.length];
      const distance = (p: THREE.Vector3) => (b[0] - a[0]) * (p.z - a[1]) - (b[1] - a[1]) * (p.x - a[0]);
      const clipped: THREE.Vector3[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i], q = polygon[(i + 1) % polygon.length], dp = distance(p), dq = distance(q);
        if (dp >= -1e-6) clipped.push(p);
        if ((dp >= 0) !== (dq >= 0)) clipped.push(p.clone().lerp(q, dp / (dp - dq)));
      }
      polygon = clipped;
    }
    if (polygon.length < 3) continue;
    const base = result.positions.length / 3;
    for (const point of polygon) result.positions.push(point.x, point.y, point.z);
    for (let i = 1; i < polygon.length - 1; i++) {
      const ab = polygon[i].clone().sub(polygon[0]), ac = polygon[i + 1].clone().sub(polygon[0]);
      if (ab.cross(ac).lengthSq() > 1e-12) result.indices.push(base, base + i, base + i + 1);
    }
  }
  geometry.dispose(); return result;
}
