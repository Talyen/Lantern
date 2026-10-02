import { expect, test, vi } from 'vitest';
import { FramePacer } from '../src/rendering/frame-pacer';
import { defaultFrameRate } from '../src/rendering/graphics-settings';
import { FrameLoop } from '../src/clearing/frame-loop';

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

test('gameplay sleeps when hidden or settled, resumes without catch-up, and closes pending frame waits', async () => {
  const requests = new Map<number, FrameRequestCallback>();
  let sequence = 0, hidden = false, paused = false, rendered = true;
  const draw = vi.fn(() => rendered), onPause = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    requests.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => requests.delete(id));
  const loop = new FrameLoop({ hidden: () => hidden, paused: () => paused, fpsLimit: () => 0, onPause, render: draw });
  const frame = (now: number) => {
    const callbacks = [...requests.values()];
    requests.clear();
    callbacks.forEach(callback => callback(now));
  };
  try {
    loop.start();
    frame(0); frame(20);
    expect(draw.mock.calls.at(-1)).toEqual([.02]);
    hidden = true; loop.visibilityChanged();
    frame(5000);
    expect(draw).toHaveBeenCalledTimes(2);
    hidden = false; loop.visibilityChanged();
    frame(6000);
    expect(draw.mock.calls.at(-1)).toEqual([0]);

    paused = true;
    frame(6020);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(draw.mock.calls.at(-1)).toEqual([0]);
    for (let i = 0; i < 100; i++) frame(6040 + i * 20);
    const settled = draw.mock.calls.length;
    frame(9000);
    expect(draw).toHaveBeenCalledTimes(settled);
    loop.invalidate(); frame(10000);
    expect(draw).toHaveBeenCalledTimes(settled + 1);
    paused = false;
    frame(20000); frame(20020);
    expect(draw.mock.calls.slice(-2)).toEqual([[0], [.02]]);

    rendered = false;
    const waited = vi.fn(), wait = loop.waitFrames(1).then(waited);
    frame(20040);
    await Promise.resolve();
    expect(waited).not.toHaveBeenCalled();
    rendered = true; frame(20060);
    await wait;
    expect(waited).toHaveBeenCalledTimes(1);

    const cancelled = expect(loop.waitFrames(2)).rejects.toThrow('closed');
    loop.dispose();
    await cancelled;
    const closed = draw.mock.calls.length;
    frame(21000); loop.invalidate(); loop.start(); frame(22000);
    expect(draw).toHaveBeenCalledTimes(closed);
  } finally { loop.dispose(); vi.unstubAllGlobals(); }
});
