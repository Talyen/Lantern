import { boundaryDistance, insideGate } from '../gameplay/area.ts';
import type { Point } from '../gameplay/area.ts';
import type { AreaDefinition, Placement } from './types.ts';
export function inReserved(area: AreaDefinition, point: Point, margin = 0): boolean { return area.reserved.some(r => Math.hypot(point[0] - r.center[0], point[1] - r.center[1]) < r.radius + margin) || area.gates.some(g => insideGate({ ...g, width: g.width + margin * 2, depth: g.depth + margin * 2 }, point) || Math.hypot(point[0] - g.arrival.position[0], point[1] - g.arrival.position[1]) < 2 + margin); }
export function generateDecoration(area: AreaDefinition): Placement[] {
  let state = area.seed >>> 0; const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const result: Placement[] = [];
  for (const scatter of area.scatter) for (let i = 0; i < scatter.count; i++) {
    const id = `${scatter.id}-${i}`, angle = random() * Math.PI * 2, radius = scatter.radius[0] + random() * (scatter.radius[1] - scatter.radius[0]);
    const position: Placement['position'] = [Math.cos(angle) * radius, .04, Math.sin(angle) * radius], yaw = random() * Math.PI * 2, scale = .5 + random() * .8;
    if (scatter.excludedIds.includes(id) || area.props.some(p => p.id === id) || boundaryDistance(area.layout.boundary, [position[0], position[2]]) < 0 || inReserved(area, [position[0], position[2]], .3)) continue;
    result.push({ id, position, yaw, scale: [scale, scale, scale], primitive: scatter.primitive, harvest: scatter.harvest, decoration: true, castShadow: false, receiveShadow: true });
  }
  return result;
}
