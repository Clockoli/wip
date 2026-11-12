import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialExecutor } from '../src/background/serial-executor.js';

test('serial executor prevents overlapping mutations and continues after rejection', async () => {
  const executor = new SerialExecutor(); const events = [];
  const first = executor.run(async () => { events.push('start-1'); await new Promise(resolve => setTimeout(resolve, 10)); events.push('end-1'); return 1; });
  const failed = executor.run(async () => { events.push('start-2'); throw new Error('expected'); });
  const third = executor.run(async () => { events.push('start-3'); events.push('end-3'); return 3; });
  assert.equal(await first, 1);
  await assert.rejects(failed, /expected/);
  assert.equal(await third, 3);
  assert.deepEqual(events, ['start-1', 'end-1', 'start-2', 'start-3', 'end-3']);
});
