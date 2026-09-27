function fail(message) { throw new Error(`Clockify history capture completion: ${message}`); }

function validTabId(value) { return Number.isInteger(value) && value >= 0; }
function validYear(value) { return Number.isInteger(value) && value >= 2000 && value <= 2100; }
function validData(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.users) && Array.isArray(value.entries);
}
function validDependencies(value) {
  return ['appendHistory', 'armCapture', 'disarmCapture', 'measure', 'configuredSnapshot', 'resolveUrls', 'createPreview', 'peekPreview', 'openPreview', 'emitPhase', 'now']
    .every(name => typeof value[name] === 'function');
}

/**
 * Advances a complete, normalized annual Clockify report through the one shared
 * history, URL-suggestion, preview-session, and preview-tab pipeline. Capture
 * transports differ only in how they produce `data`.
 */
export async function completeClockifyHistoryCapture({ tabId, year, data, ...dependencies }) {
  if (!validTabId(tabId) || !validYear(year) || !validData(data) || !validDependencies(dependencies)) fail('invalid dependencies');
  const {
    appendHistory, armCapture, disarmCapture, measure, configuredSnapshot,
    resolveUrls, createPreview, peekPreview, openPreview, emitPhase, now,
  } = dependencies;
  const entryCount = data.entries.length;

  emitPhase(tabId, { phase: 'saving_current_report', entryCount, year });
  const appendStartedAt = now();
  const history = await appendHistory(year, data);
  await measure('history_append', now() - appendStartedAt, entryCount);
  if (!history?.complete) {
    if (!Number.isInteger(history?.nextYear) || !history.history) fail('history capture did not return a continuation');
    await armCapture(tabId);
    return { continuing: true, nextYear: history.nextYear, history: history.history };
  }
  if (!validData(history.data)) fail('history capture did not return aggregate data');

  const { config, auth } = await configuredSnapshot();
  if (!config || !auth) throw new Error('Connect a Clockoli GitHub repository before creating a Clockify preview.');
  const aggregateEntryCount = history.data.entries.length;
  emitPhase(tabId, { phase: 'checking_task_projects', entryCount: aggregateEntryCount, year });
  const resolveStartedAt = now();
  const resolvedEntries = await resolveUrls(history.data.entries, config, {
    onCatalogReady: () => emitPhase(tabId, { phase: 'preparing_task_suggestions', entryCount: aggregateEntryCount, year }),
  });
  await measure('task_url_resolution', now() - resolveStartedAt, aggregateEntryCount);

  emitPhase(tabId, { phase: 'saving_preview', entryCount: resolvedEntries.length, year });
  const previewSessionStartedAt = now();
  await createPreview({ users: history.data.users, entries: resolvedEntries });
  if (!await peekPreview()) throw new Error('Clockify preview is unavailable immediately after it was created.');
  await measure('preview_session_write', now() - previewSessionStartedAt, resolvedEntries.length);

  emitPhase(tabId, { phase: 'opening_preview', entryCount: resolvedEntries.length, year });
  const previewTabStartedAt = now();
  const previewTab = await openPreview();
  if (!Number.isInteger(previewTab?.id)) throw new Error('Clockify preview tab could not be opened.');
  await measure('preview_tab_create', now() - previewTabStartedAt);
  await disarmCapture(tabId);
  return { captured: true, history: history.history };
}
