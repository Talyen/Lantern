import { expect, test } from 'vitest';
import { MovementWorld } from '../src/gameplay/movement';
import { waterGround } from '../src/levels/water-terrain';
import type { AreaDefinition } from '../src/levels/types';

const area: AreaDefinition = {
  version: 1, id: 'water-ground', name: 'Water ground', seed: 1, lighting: {}, scatter: [], reserved: [], gates: [], views: [],
  envelope: { width: 8, depth: 8, apron: 0, yaw: 0, reference: { width: 1280, height: 800, zoom: 1 }, screen: [8, 8] },
  layout: { boundary: { kind: 'polygon', points: [[-4, -4], [4, -4], [4, 4], [-4, 4]] }, player: { position: [0, -2.5], yaw: 0 } },
  props: [{ id: 'ground', position: [0, -.2, 0], yaw: 0, scale: [1, 1, 1], terrain: true, castShadow: false, receiveShadow: true,
    primitive: { kind: 'box', size: [8, .4, 8], color: '#68523d' } }],
  effects: { fires: [], water: [{ id: 'water', position: [0, 0], width: 6, length: 4, flow: .1, channel: { sections: [
    { x: -3, z: 0, width: 2, depth: .2 }, { x: 3, z: 0, width: 2, depth: .2 },
  ] } }] },
};
function actor() { return { x: 0, y: 0, z: -2.5, yaw: 0, hp: 100, speed: 3, lock: 0, attackTime: -1, contactIndex: 0 }; }

test.each(['channel', 'pond', 'raised-pond'] as const)('characters descend into authored water ground and can return to dry ground (%s)', async shape => {
  const fixture = structuredClone(area);
  if (shape !== 'channel') fixture.effects.water[0] = { id: 'water', position: [0, 0], width: 6, length: 4, flow: 0, depth: .2, preset: 'pond' };
  const elevation = shape === 'raised-pond' ? 1 : 0;
  if (elevation) { fixture.props[0].position[1] += elevation; fixture.effects.water[0].height = elevation + .04; }
  const world = await MovementWorld.create(fixture.layout.boundary, { obstacles: [], ground: waterGround(fixture)! });
  try {
    const player = actor();
    for (let i = 0; i < 100; i++) world.move('player', player, 0, .025, 1 / 60);
    expect(player.y - elevation).toBeLessThan(-.1);
    expect(player.y - elevation).toBeGreaterThan(-.24);
    for (let i = 0; i < 160; i++) world.move('player', player, 0, -.025, 1 / 60);
    expect(player.z).toBeLessThan(-2);
    expect(Math.abs(player.y - elevation)).toBeLessThan(.025);
  } finally { world.dispose(); }
});

test.each(['channel', 'pond', 'raised-pond'] as const)('loot on a below-zero water bed remains grounded and reachable (%s)', async shape => {
  const fixture = structuredClone(area);
  if (shape !== 'channel') fixture.effects.water[0] = { id: 'water', position: [0, 0], width: 6, length: 4, flow: 0, depth: .2, preset: 'pond' };
  const elevation = shape === 'raised-pond' ? 1 : 0;
  if (elevation) { fixture.props[0].position[1] += elevation; fixture.effects.water[0].height = elevation + .04; }
  const world = await MovementWorld.create(fixture.layout.boundary, { obstacles: [], ground: waterGround(fixture)! });
  try {
    const player = actor();
    for (let i = 0; i < 100; i++) world.move('player', player, 0, .025, 1 / 60);
    const drop = world.lootGround([player.x, player.z], 0, player);
    expect(drop.height - elevation).toBeLessThan(-.1);
    expect(world.pickupPath(player, drop.position, drop.height)).not.toBeNull();
  } finally { world.dispose(); }
});
