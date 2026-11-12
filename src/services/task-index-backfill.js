import { parseTaskIndex } from '../domain/task-index.js';
import { normalizeTaskTitle, validateTimestamp } from '../domain/records.js';

// This function never changes the index. Every indexed ID must have exactly one
// matching completed record in the same immutable repository snapshot.
export function previewTaskIndexBackfill(index, records) {
  const valid = parseTaskIndex(JSON.stringify(index), { user: index?.storageLogin });
  const owners = new Map();
  for (const [taskUrl, summary] of Object.entries(valid.tasks)) {
    for (const id of summary.recordIds) owners.set(id, taskUrl);
  }
  const byTask = new Map();
  const seen = new Set();
  const totals = new Map();
  for (const record of records) {
    const owner = owners.get(record.id);
    if (!owner || owner !== record.taskUrl || seen.has(record.id)
        || !Number.isSafeInteger(record.durationSeconds) || record.durationSeconds < 0) {
      throw new Error('Clockoli task index does not match completed records');
    }
    seen.add(record.id);
    totals.set(owner, (totals.get(owner) || 0) + record.durationSeconds);
    if (!byTask.has(owner)) byTask.set(owner, []);
    byTask.get(owner).push(record);
  }
  if (seen.size !== owners.size || Object.entries(valid.tasks).some(([taskUrl, summary]) =>
    totals.get(taskUrl) !== summary.totalSeconds)) {
    throw new Error('Clockoli task index does not match completed records');
  }
  const counts = { tasks: Object.keys(valid.tasks).length, existing: 0, found: 0,
    untitled: 0, ambiguous: 0, records: seen.size };
  const proposals = [];
  for (const [taskUrl, summary] of Object.entries(valid.tasks)) {
    if (summary.title) { counts.existing++; continue; }
    const titled = byTask.get(taskUrl).map(record => ({ id: record.id,
      title: normalizeTaskTitle(record.taskTitle ?? record.issueTitle ?? ''), startedAt: record.startedAt,
      startedMs: Date.parse(validateTimestamp(record.startedAt)),
    })).filter(record => record.title);
    if (!titled.length) { counts.untitled++; continue; }
    const latest = titled.reduce((max, record) => Math.max(max, record.startedMs), -Infinity);
    const choices = titled.filter(record => record.startedMs === latest);
    if (new Set(choices.map(record => record.title)).size > 1) { counts.ambiguous++; continue; }
    const selected = choices.sort((a, b) => a.id.localeCompare(b.id))[0];
    counts.found++;
    proposals.push({ taskUrl, title: selected.title, titleSourceId: selected.id, titleStartedAt: selected.startedAt });
  }
  return { counts, proposals };
}
