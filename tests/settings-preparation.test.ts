import { expect, test, vi } from 'vitest';
import { SettingsPreparation } from '../src/rendering/settings-preparation';

test('rapid graphics changes serialize, discard superseded preparations and retain the committed result on failure', async () => {
  vi.useFakeTimers();
  const releases: number[] = [], commits: number[] = [], errors: unknown[] = [];
  const resolve: ((candidate: { commit(): void; dispose(): void }) => void)[] = [];
  const prepare = vi.fn((value: number) => value === 4 ? Promise.reject(new Error('compile')) : new Promise<{ commit(): void; dispose(): void }>(accept => resolve.push(accept)));
  const queue = new SettingsPreparation(prepare, error => errors.push(error));
  const candidate = (value: number) => ({ commit: () => commits.push(value), dispose: () => releases.push(value) });
  try {
    queue.request(1); await vi.advanceTimersByTimeAsync(149); expect(prepare).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(queue.busy).toBe(true);
    queue.request(2); queue.request(3); queue.flush(); expect(prepare).toHaveBeenCalledTimes(1);
    resolve.shift()!(candidate(1)); await Promise.resolve(); await Promise.resolve();
    expect(releases).toEqual([1]); expect(prepare.mock.calls.map(([value]) => value)).toEqual([1, 3]);
    resolve.shift()!(candidate(3)); await queue.ready(); expect(commits).toEqual([3]);
    queue.request(4); await queue.ready(); expect(errors).toHaveLength(1); expect(commits).toEqual([3]);
    queue.request(5); queue.flush(); queue.dispose(); resolve.shift()!(candidate(5)); await queue.ready();
    expect(releases).toEqual([1, 5]); expect(commits).toEqual([3]);
  } finally { queue.dispose(); vi.useRealTimers(); }
});

// A failed cleanup must not retry disposal or leave readiness waiting forever.
test('failed commit releases once, reports cleanup failure and permits a later request', async () => {
  const errors: unknown[] = [], commits: number[] = [];
  const dispose = vi.fn(() => { throw new Error('release failed'); });
  const queue = new SettingsPreparation(async (value: number) => ({
    commit: () => { if (value === 1) throw new Error('commit failed'); commits.push(value); }, dispose,
  }), error => errors.push(error));
  try {
    queue.request(1); await queue.ready();
    expect(dispose).toHaveBeenCalledOnce(); expect(errors).toHaveLength(1);
    queue.request(2); await queue.ready(); expect(commits).toEqual([2]);
  } finally { queue.dispose(); }
});
