import { expect, test } from 'vitest';
import { FramePacer } from '../src/rendering/frame-pacer';
import { defaultFrameRate } from '../src/rendering/graphics-settings';

test('60 FPS cap stays near 60 across nominal and faster displays, then Unlimited allows every frame', () => {
  for (const displayHz of [59.94, 120, 144, 240]) {
    const pacer = new FramePacer();
    let rendered = 0;
    for (let frame = 0; frame < displayHz * 5; frame++) {
      if (pacer.shouldRender(frame * 1000 / displayHz, 60)) rendered++;
    }
    expect(rendered).toBeGreaterThanOrEqual(299);
    expect(rendered).toBeLessThanOrEqual(302);
    expect(pacer.shouldRender(5000, 0)).toBe(true);
    expect(pacer.shouldRender(5001, 0)).toBe(true);
    expect(pacer.shouldRender(5002, 120)).toBe(true);
    expect(pacer.shouldRender(5003, 120)).toBe(false);
  }
});

test('initial cap follows supported monitor rates and falls back to 60', () => {
  expect([0, 59.94, 120, 143.98, 165, 239.98].map(defaultFrameRate)).toEqual([60, 60, 120, 144, 144, 240]);
});
