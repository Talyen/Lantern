import { Vector3, type BufferAttribute, type InterleavedBufferAttribute } from 'three';

type WaterAttribute = BufferAttribute | InterleavedBufferAttribute;

/** PlaneGeometry's row-major grid repeats each X/Z wave term across an entire axis. */
export function createWaterWaves(position: WaterAttribute, columns: number, rows: number) {
  const x = new Float32Array(columns), z = new Float32Array(rows);
  const xHeight = new Float64Array(columns), xSlope = new Float64Array(columns);
  const zHeight = new Float64Array(rows), zSlope = new Float64Array(rows);
  const normal = new Vector3();
  for (let column = 0; column < columns; column++) x[column] = position.getX(column);
  for (let row = 0; row < rows; row++) z[row] = position.getZ(row * columns);
  return {
    update(time: number, position: WaterAttribute, normals: WaterAttribute): void {
      // Keep double precision until the final attribute write, as in the original
      // vertex loop. Rounding intermediate terms would change the water surface.
      for (let column = 0; column < columns; column++) {
        const a = x[column] * 2 + time;
        xHeight[column] = Math.sin(a) * .018;
        xSlope[column] = -Math.cos(a) * .036;
      }
      for (let row = 0; row < rows; row++) {
        const b = z[row] * 3 - time * .8;
        zHeight[row] = Math.cos(b) * .012;
        zSlope[row] = Math.sin(b) * .036;
      }
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const index = row * columns + column;
        position.setY(index, xHeight[column] + zHeight[row]);
        normal.set(xSlope[column], 1, zSlope[row]).normalize();
        normals.setXYZ(index, normal.x, normal.y, normal.z);
      }
      position.needsUpdate = normals.needsUpdate = true;
    },
  };
}
