import { expect, test } from 'vitest';
import { lightingPreparationKey } from '../src/levels/lighting-preparation';
import { resolveAreaLighting } from '../src/levels/lighting';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import type { AreaDefinition, ResolvedAreaDefinition } from '../src/levels/types';
// Normal entry must reject changed static captures without live GPU baking; unrelated gameplay must not invalidate them.
test('prepared capture keys invalidate static edits and distinguish restored Homestead only', async () => {
  const area = { ...homestead, lighting: resolveAreaLighting(homestead as unknown as AreaDefinition) } as unknown as ResolvedAreaDefinition;
  const key = (a: ResolvedAreaDefinition, restored = false) => lightingPreparationKey(a, 'projected', restored, '186', { version: 1 });
  const initial = await key(area), changed = structuredClone(area); changed.name = 'Other'; changed.level = 99;
  expect(await key(changed)).toBe(initial);
  changed.props[0].position[0] += 1; expect(await key(changed)).not.toBe(initial);
  expect(await key(area, true)).not.toBe(initial);
  const field = { ...clearing, lighting: resolveAreaLighting(clearing as unknown as AreaDefinition) } as unknown as ResolvedAreaDefinition;
  expect(await key(field, true)).toBe(await key(field));
});
