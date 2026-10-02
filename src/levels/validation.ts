import { itemIds, weaponFamily } from '../gameplay/equipment.ts';
import { resolveAreaLighting } from './lighting.ts';
import { resolveLocalLight } from './local-lighting.ts';
import { inReserved } from './decoration.ts';
import { boundaryDistance, insideGate } from '../gameplay/area.ts';
import type { AreaDefinition, AssetRef } from './types.ts';
export function assetReferences(area: AreaDefinition): AssetRef[] { return [...area.props.flatMap(p => [p.asset, p.fallback].filter((a): a is AssetRef => !!a)), ...area.effects.fires.map(f => f.asset), ...(area.shop ? [{url:area.shop.merchant.model}] : []), ...(area.shelter ? [{libraryId:'generic:model:sm-gen-prop-chest-01'}] : [])]; }
export { inReserved, generateDecoration } from './decoration.ts';
/** Validation is shared by live preview and Node tooling. Errors identify the area/object. */
export function validateAreas(input: Record<string, AreaDefinition>): string[] {
  const errors: string[] = [];
  for (const [key, area] of Object.entries(input)) {
    let owner = key;
    const fail = (message: string) => errors.push(`${owner}: ${message}`);
    const finite = (values: number[], length?: number) => Array.isArray(values) && (!length || values.length === length) && values.every(v => typeof v === 'number' && Number.isFinite(v));
    const ids = new Set<string>(); const id = (value: string) => { owner = `${key}/${value}`; if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value) || ids.has(value)) fail('invalid or duplicate stable object ID'); ids.add(value); };
    try {
      if (area.version !== 1 || area.id !== key || !/^[a-z][a-z0-9-]*$/.test(key)) fail('expected version 1 and a stable area ID');
      const reward = (source: { level?: number; gold?: boolean }) => {
        if (source.level !== undefined && (!Number.isSafeInteger(source.level) || source.level < 1)) fail('reward level must be a positive integer');
        if (source.gold !== undefined && typeof source.gold !== 'boolean') fail('gold eligibility must be boolean');
      };
      reward(area);
      for (const spawn of [area.layout.enemy, area.layout.caster]) if (spawn) {
        reward(spawn);
        if (spawn.humanoid !== undefined && typeof spawn.humanoid !== 'boolean') fail('humanoid eligibility must be boolean');
        if (spawn.rank !== undefined && !['normal','elite','boss'].includes(spawn.rank)) fail('unknown enemy reward rank');
      }
      const e = area.envelope;
      if (!finite([e.width, e.depth, e.apron, e.yaw, e.reference.width, e.reference.height, e.reference.zoom, ...e.screen]) || e.width <= 0 || e.depth <= 0 || e.apron < 0) fail('invalid design envelope');
      if (!Number.isInteger(area.seed)) fail('decoration seed must be an integer');
      if (!area.legacy && (Math.abs(e.width - e.screen[0] * 2) > .01 || Math.abs(e.depth - e.screen[1] * 2) > .01)) fail('standard envelope must be 2 × 2 reference screens');
      const boundary = area.layout.boundary;
      if (boundary.kind === 'circle') { if (!finite(boundary.center, 2) || !Number.isFinite(boundary.radius) || boundary.radius <= 0) fail('invalid circular boundary'); }
      else if (boundary.kind === 'polygon') {
        if (boundary.points.length < 3 || !boundary.points.every(p => finite(p, 2))) fail('invalid polygon');
        boundary.points.forEach((a, i, points) => { const b = points[(i + 1) % points.length]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < .001 || points.some(p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < -.001)) fail('boundary must be convex and counterclockwise'); });
      } else fail('unknown boundary kind');
      if (area.layout.enemies && (area.layout.enemy || area.layout.caster)) fail('choose authored enemies or legacy enemy/caster spawns, not both');
      const enemies = area.layout.enemies;
      if (enemies !== undefined && !Array.isArray(enemies)) fail('enemies must be a list');
      for (const enemy of enemies ?? []) {
        id(enemy.id);
        if (enemy.id === 'player' || Object.hasOwn(Object.prototype, enemy.id)) fail('reserved actor ID');
        if (!['raider','caster'].includes(enemy.kind) || !['enemy','skeleton'].includes(enemy.rig)) fail('unknown enemy behavior or rig');
        if (!enemy.loadout || !(enemy.kind === 'caster' ? enemy.loadout.main === 'staff' : ['axe','sword'].includes(weaponFamily(enemy.loadout.main) ?? '')) || ![null,'shield'].includes(enemy.loadout.off) || enemy.kind === 'caster' && enemy.loadout.off) fail('invalid enemy loadout');
      }
      const spawns = enemies ? [{ id: 'player', ...area.layout.player }, ...enemies] : (area.kind === 'safe' ? ['player'] : ['player', 'enemy', ...(area.layout.caster ? ['caster'] : [])]).map(who => ({ id: who, ...area.layout[who as 'player' | 'enemy' | 'caster']! }));
      for (const spawn of spawns) { owner = `${key}/${spawn.id}`; if (!finite(spawn.position, 2) || !Number.isFinite(spawn.yaw) || boundaryDistance(boundary, spawn.position) < 0) fail('spawn must be finite and inside the walkable boundary'); }
      if (area.ambience !== undefined && !['woodland','quiet'].includes(area.ambience)) fail('unknown ambience');
      if (area.kind !== undefined && !['safe', 'encounter'].includes(area.kind)) fail('unknown area kind');
      for (const fire of area.campfires ?? []) {
        id(fire.id);
        if (!finite(fire.position, 2) || !finite(fire.arrival.position, 2) || !Number.isFinite(fire.arrival.yaw) || boundaryDistance(boundary, fire.position) < 0 || boundaryDistance(boundary, fire.arrival.position) < 0) fail('campfire and arrival must be inside the walkable boundary');
        if (!area.effects.fires.some(effect => effect.id === fire.id)) fail('interactive campfire needs a fire effect');
        if (fire.heals !== undefined && typeof fire.heals !== 'boolean') fail('heals must be boolean');
      }
      if (area.shop) {
        id(area.shop.id);
        const shop = area.shop, merchant = shop.merchant;
        if (area.id !== 'homestead' || area.kind !== 'safe' || !area.props.some(prop => prop.id === shop.prop)
          || !finite(shop.position, 2) || boundaryDistance(boundary, shop.position) < 0
          || !finite(merchant.position, 2) || boundaryDistance(boundary, merchant.position) < 0
          || !Number.isFinite(merchant.yaw) || !Number.isFinite(merchant.height) || merchant.height <= 0)
          fail('invalid Homestead shop');
      }
      if (area.shelter && (!finite(area.shelter.position,2) || !finite(area.shelter.stash,2) || !Number.isFinite(area.shelter.yaw) || boundaryDistance(boundary,area.shelter.position)<0 || boundaryDistance(boundary,area.shelter.stash)<0)) fail('invalid shelter position');
      if (area.portalArrival && (!finite(area.portalArrival.position, 2) || !Number.isFinite(area.portalArrival.yaw) || boundaryDistance(boundary, area.portalArrival.position) < 0)) fail('invalid portal arrival');
      for (const region of area.reserved) { id(region.id); if (!finite(region.center, 2) || !Number.isFinite(region.radius) || region.radius <= 0) fail('invalid reserved region'); }
      for (const prop of area.props) {
        id(prop.id);
        if (!finite(prop.position, 3) || !finite(prop.scale, 3) || prop.scale.some(s => s <= 0) || !Number.isFinite(prop.yaw) || prop.height !== undefined && (!Number.isFinite(prop.height) || prop.height <= 0)) fail('invalid transform');
        if (typeof prop.castShadow !== 'boolean' || typeof prop.receiveShadow !== 'boolean') fail('shadow flags must be explicit booleans');
        if (!!prop.asset === !!prop.primitive) fail('choose exactly one asset or primitive');
        if (prop.primitive?.surface !== undefined && !['woodland','stone'].includes(prop.primitive.surface)) fail('unknown ground surface');
        if (prop.harvest && (!['tree','stone','iron'].includes(prop.harvest.kind) || prop.harvest.radius !== undefined && (!Number.isFinite(prop.harvest.radius) || prop.harvest.radius <= 0))) fail('invalid tree harvest metadata');
        if (prop.harvest && [prop.harvest.level,prop.harvest.baseYield,prop.harvest.contacts].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 1))) fail('invalid resource progression metadata');
        if (prop.primitive?.patches !== undefined) {
          if (prop.primitive.surface !== 'woodland' || !Array.isArray(prop.primitive.patches)) fail('patches require a woodland surface and a list');
          else for (const patch of prop.primitive.patches) {
            if (!patch || !finite(patch.center, 2) || !Number.isFinite(patch.radius) || patch.radius <= 0 || !Number.isFinite(patch.strength) || patch.strength < 0 || patch.strength > 1 || typeof patch.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(patch.color)) fail('invalid woodland patch');
            if (patch?.layer !== undefined && !['earth', 'litter', 'rocky-soil'].includes(patch.layer)) fail('unknown woodland material layer');
          }
        }
        if (prop.primitive && (!['box', 'cylinder', 'pebble', 'tent', 'headstone'].includes(prop.primitive.kind) || !finite(prop.primitive.size) || prop.primitive.size.some(s => s <= 0))) fail('invalid primitive');
        if (prop.visibility !== undefined && prop.visibility !== 'lighting-only') fail('unknown placement visibility');
        if (prop.visibility !== 'lighting-only' && (prop.decoration || !area.legacy && !prop.terrain) && inReserved(area, [prop.position[0], prop.position[2]], .3)) fail('scenery overlaps a reserved combat/route/arrival region or gate');
        const u = prop.position[0] * Math.cos(e.yaw) - prop.position[2] * Math.sin(e.yaw), v = prop.position[0] * Math.sin(e.yaw) + prop.position[2] * Math.cos(e.yaw);
        if (Math.abs(u) > e.width / 2 + e.apron || Math.abs(v) > e.depth / 2 + e.apron) fail('position exceeds the decorative apron');
      }
      for (const obstacle of area.traversal?.obstacles ?? []) {
        owner = `${key}/collision:${obstacle.id}`;
        if (!finite(obstacle.position, 3) || !finite(obstacle.size, 3) || obstacle.size.some(v => v <= 0) || !Number.isFinite(obstacle.yaw)) fail('invalid collision proxy');
      }
      for (const surface of area.traversal?.surfaces ?? []) {
        owner = `${key}/walkable-surface`;
        if (!finite(surface.positions) || surface.positions.length % 3 || !Array.isArray(surface.indices) || surface.indices.length % 3 || surface.indices.some(i => !Number.isInteger(i) || i < 0 || i >= surface.positions.length / 3)) fail('invalid surface triangles');
      }
      for (const portal of area.effects.portals ?? []) {
        id(portal.id);
        if (!finite(portal.position, 3) || !finite([portal.yaw, portal.width, portal.height]) || portal.width <= 0 || portal.height <= 0) fail('invalid portal transform');
      }
      for (const chest of area.chests ?? []) {
        reward(chest);
        if (chest.guard !== undefined && chest.guards !== undefined) fail('choose guard or guards, not both');
        const guards = chest.guards ?? (chest.guard ? [chest.guard] : []);
        if (!Array.isArray(guards) || new Set(guards).size !== guards.length || guards.some(guard => !(enemies ? enemies.some(enemy => enemy.id === guard) : ['enemy','caster'].includes(guard) && !!area.layout[guard as 'enemy' | 'caster']))) fail('chest guards must name placed enemies');
        id(chest.id);
        if (!finite(chest.position, 2) || boundaryDistance(boundary, chest.position) < 0 || !Number.isInteger(chest.scrolls) || chest.scrolls < 0) fail('invalid chest position/reward');
        if (chest.potions !== undefined && (!Number.isSafeInteger(chest.potions) || chest.potions < 0)) fail('invalid potion reward');
        if (chest.equipment !== undefined && (!Array.isArray(chest.equipment) || !chest.equipment.every(item=>itemIds.includes(item)))) fail('invalid equipment reward');
        const prop = area.props.find(p => p.id === chest.prop);
        if (!prop?.asset || Math.hypot(prop.position[0] - chest.position[0], prop.position[2] - chest.position[1]) > .1) fail('chest must reference its placed asset');
      }
      for (const [enemy,items] of Object.entries(area.enemyEquipment ?? {})) {
        if (!(enemies ? enemies.some(spawn => spawn.id === enemy) : ['enemy','caster'].includes(enemy) && !!area.layout[enemy as 'enemy'|'caster']) || !Array.isArray(items) || !items.every(item=>itemIds.includes(item))) fail('invalid enemy equipment rewards');
      }
      for (const scatter of area.scatter) {
        id(scatter.id); if (!Number.isInteger(scatter.count) || scatter.count < 0 || scatter.count > 2000 || !finite(scatter.radius, 2) || scatter.radius[0] < 0 || scatter.radius[1] < scatter.radius[0]) fail('invalid scatter count/radius');
        if (scatter.harvest && (!['tree','stone','iron'].includes(scatter.harvest.kind) || scatter.harvest.radius !== undefined && (!Number.isFinite(scatter.harvest.radius) || scatter.harvest.radius <= 0))) fail('invalid tree harvest metadata');
      }
      for (const patch of area.grass ?? []) {
        id(patch.id);
        if (!finite(patch.center, 2) || !finite(patch.radii, 2) || patch.radii.some(r => r <= 0 || r > 20) || !finite([patch.yaw, patch.density]) || patch.density <= 0 || patch.density > 400 || boundaryDistance(boundary, patch.center) < 0) fail('invalid grass patch');
      }
      for (const gate of area.gates) {
        id(gate.id);
        if (!finite(gate.position, 2) || !finite(gate.arrival.position, 2) || !finite([gate.yaw, gate.arrival.yaw, gate.width, gate.depth]) || gate.width <= 0 || gate.depth <= 0) fail('invalid gate geometry');
        if (boundaryDistance(boundary, gate.arrival.position) < 2 - .001) fail('arrival must be at least 2 m inside the boundary');
        const target = input[gate.destination.area]?.gates.find(g => g.id === gate.destination.gate); if (!target) fail(`broken link to ${gate.destination.area}/${gate.destination.gate}`);
        if (area.props.some(p => p.decoration && insideGate(gate, [p.position[0], p.position[2]]))) fail('gate opening contains decoration');
      }
      if (area.terminal !== undefined && typeof area.terminal !== 'boolean') fail('terminal must be boolean');
      if (area.kind !== 'safe' && (area.gates.filter(g => g.role === 'entrance').length !== 1 || area.gates.filter(g => g.role === 'exit').length !== (area.terminal ? 0 : 1))) fail('requires one primary entrance and an exit unless terminal');
      for (const view of area.views) { id(view.id); if (!finite(view.target, 3)) fail('invalid capture target'); }
      for (const required of ['entrance', 'center', 'exit', 'review-1', 'review-2']) if (!area.views.some(v => v.id === required)) fail(`missing ${required} viewpoint`);
      owner = key;
      for (const fire of area.effects.fires) {
        const recipe = resolveLocalLight(fire);
        if (!finite([recipe.intensity, recipe.distance, recipe.emitterHeight]) || recipe.intensity < 0 || recipe.distance <= 0 || !/^#[0-9a-f]{6}$/i.test(recipe.color) || typeof recipe.shadow !== 'boolean') fail('invalid local light');
      }
      const l = resolveAreaLighting(area);
      if (!finite([l.fogNear, l.fogFar, l.ambient.intensity, l.sun.intensity, l.sun.shadowExtent, ...l.sun.position]) || l.fogNear < 0 || l.fogFar <= l.fogNear || l.sun.shadowExtent <= 0) fail('invalid lighting');
      const color = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
      if (![l.background, l.ambient.sky, l.ambient.ground, l.sun.color].every(color) || l.sun.intensity < 0 || l.ambient.intensity < 0 || l.sun.position.every(n => n === 0)) fail('invalid lighting colors/intensity/direction');
      if (l.environment && (!finite([l.environment.intensity, l.environment.sunIntensity, l.environment.rotation]) || l.environment.intensity < 0 || l.environment.sunIntensity < 0 || ![l.environment.sky, l.environment.horizon, l.environment.ground, l.environment.sunColor].every(color))) fail('invalid environment lighting');
      if (l.grade && (!color(l.grade.shadows) || !color(l.grade.highlights) || !finite([l.grade.strength]) || l.grade.strength < 0 || l.grade.strength > 1)) fail('invalid lighting grade');
      if (l.saturation !== undefined && (!finite([l.saturation]) || l.saturation < 0 || l.saturation > 1)) fail('invalid lighting saturation');
      if (l.probes && (!finite(l.probes.position, 3) || !finite(l.probes.size, 3) || l.probes.size.some(n => n <= 0) || !finite(l.probes.resolution, 3) || l.probes.resolution.some(n => !Number.isInteger(n) || n < 2) || l.probes.resolution.reduce((a,b) => a*b, 1) > 4096 || !finite([l.probes.intensity, l.probes.bounces]) || l.probes.intensity < 0 || !Number.isInteger(l.probes.bounces) || l.probes.bounces < 0 || l.probes.bounces > 2)) fail('invalid irradiance probes');
      for (const asset of assetReferences(area)) if ('url' in asset ? !asset.url.startsWith('/vendor/') || asset.url.includes('..') : !asset.libraryId) fail('asset must reference private vendor art or a catalog ID');
    } catch (error) { fail(`invalid definition: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return errors;
}
