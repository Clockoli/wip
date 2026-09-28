import test from 'node:test';
import assert from 'node:assert/strict';
import { completeClockifyHistoryCapture } from '../src/services/clockify-history-capture-completion.js';

const data = Object.freeze({
  users: Object.freeze([{ userId: 'person-1', displayName: 'Ada', entryCount: 1 }]),
  entries: Object.freeze([{ entryId: 'entry-1' }]),
});
const completeHistory = Object.freeze({ totalYears: 6, completedYears: 6, yearsWithEntries: [2026, 2025, 2024, 2023, 2022, 2021] });

function dependencies({ history = { complete: true, data, history: completeHistory }, preview = { id: 'preview-1' } } = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      appendHistory: async (year, received) => { calls.push(['appendHistory', year, received]); return history; },
      armCapture: async tabId => { calls.push(['armCapture', tabId]); },
      disarmCapture: async tabId => { calls.push(['disarmCapture', tabId]); },
      measure: async (name, value, count) => { calls.push(['measure', name, value, count]); },
      configuredSnapshot: async () => ({ config: { owner: 'clockoli', repo: 'time' }, auth: { githubLogin: 'ada' } }),

      createPreview: async received => { calls.push(['createPreview', received]); },
      peekPreview: async () => { calls.push(['peekPreview']); return preview; },
      openPreview: async () => { calls.push(['openPreview']); return { id: 99 }; },
      emitPhase: (_tabId, phase) => { calls.push(['emitPhase', phase]); },
      now: (() => { let value = 0; return () => ++value; })(),
    },
  };
}

test('completes a normalized annual capture through the shared history-to-preview pipeline', async () => {
  const { calls, dependencies: completion } = dependencies();

  const result = await completeClockifyHistoryCapture({ tabId: 7, year: 2026, data, ...completion });

  assert.deepEqual(result, { captured: true, history: completeHistory });
  assert.deepEqual(calls.map(([name]) => name), [
    'emitPhase', 'appendHistory', 'measure', 'emitPhase', 'createPreview', 'peekPreview', 'measure', 'emitPhase', 'openPreview',
    'measure', 'disarmCapture',
  ]);
  assert.deepEqual(calls.find(([name]) => name === 'appendHistory'), ['appendHistory', 2026, data]);
  assert.deepEqual(calls.filter(([name]) => name === 'emitPhase').map(([, phase]) => phase.phase), [
    'saving_current_report', 'saving_preview', 'opening_preview',
  ]);
  assert.deepEqual(calls.find(([name]) => name === 'createPreview'), ['createPreview', data]);
});

test('returns the next annual unit before resolution and preview work when history capture continues', async () => {
  const history = { complete: false, nextYear: 2025, history: { totalYears: 2, completedYears: 1, yearsWithEntries: [2026, 2025] } };
  const { calls, dependencies: completion } = dependencies({ history });

  const result = await completeClockifyHistoryCapture({ tabId: 7, year: 2026, data, ...completion });

  assert.deepEqual(result, { continuing: true, nextYear: 2025, history: history.history });
  assert.deepEqual(calls.map(([name]) => name), ['emitPhase', 'appendHistory', 'measure', 'armCapture']);
});

test('does not report capture success when the newly created preview cannot be read back', async () => {
  const { dependencies: completion } = dependencies({ preview: null });

  await assert.rejects(
    () => completeClockifyHistoryCapture({ tabId: 7, year: 2026, data, ...completion }),
    /preview is unavailable/i,
  );
});

test('rejects malformed completion inputs before any capture side effect', async () => {
  const { calls, dependencies: completion } = dependencies();

  await assert.rejects(
    () => completeClockifyHistoryCapture({ tabId: -1, year: 2026, data, ...completion }),
    /invalid dependencies/i,
  );
  assert.deepEqual(calls, []);
});

test('does not disarm a capture when opening the preview tab fails', async () => {
  const { calls, dependencies: completion } = dependencies();
  completion.openPreview = async () => ({});

  await assert.rejects(
    () => completeClockifyHistoryCapture({ tabId: 7, year: 2026, data, ...completion }),
    /preview tab could not be opened/i,
  );
  assert.equal(calls.some(([name]) => name === 'disarmCapture'), false);
});
