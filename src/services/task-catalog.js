// Searchable, page-safe task metadata projected from validated work records.
// Imported identities are destination-bound; HTTP(S) identities are global.
import { trackedTaskKey } from '../domain/tasks.js';

export function taskCandidates(records) {
  const byIdentity = new Map();
  for (const record of records) {
    const taskUrl = record.taskUrl ?? record.issue?.url;
    if (typeof taskUrl !== 'string' || !taskUrl) continue;
    const imported = !/^https?:\/\//i.test(taskUrl);
    const destinations = [record.destinationId, ...(record.duplicateDestinations ?? [])];
    for (const [index, destinationId] of [...new Set(destinations)].entries()) {
      if (!destinationId) continue;
      const key = trackedTaskKey({ taskUrl, destinationId });
      const current = byIdentity.get(key) ?? { taskUrl, title: '', stamp: '', destinationIds: new Set(), timeRepository: '' };
      const title = String(record.taskTitle ?? record.issueTitle ?? '').trim().slice(0, 300);
      const stamp = String(record.startedAt ?? '');
      if (title && (!current.title || stamp >= current.stamp)) { current.title = title; current.stamp = stamp; }
      current.destinationIds.add(destinationId);
      if (imported) current.timeRepository = index === 0 ? record.timeRepository || ''
        : record.duplicateTimeRepositories?.[index] || '';
      byIdentity.set(key, current);
    }
  }
  return [...byIdentity.values()].filter(value => value.title)
    .sort((a, b) => a.taskUrl.localeCompare(b.taskUrl)
    || [...a.destinationIds][0].localeCompare([...b.destinationIds][0])).map(value => (
    /^https?:\/\//i.test(value.taskUrl)
      ? { taskUrl: value.taskUrl, title: value.title, destinationIds: [...value.destinationIds].sort() }
      : { taskUrl: value.taskUrl, title: value.title, destinationId: [...value.destinationIds][0], timeRepository: value.timeRepository }
  ));
}

// Indexes carry record IDs, not persistent record bodies. If an ID appears twice,
// read the exact monthly bodies before deciding whether it is a mirror or conflict.
export function mergeTaskCatalogIndexes(results) {
  const seen = new Map(), duplicates = new Map(), candidates = [];
  for (const { destination, records } of results) {
    for (const catalog of records) {
      for (const id of catalog.recordIds) {
        if (seen.has(id)) {
          if (seen.get(id) !== destination.id) return { records: [], conflicts: [], fallback: true };
          duplicates.set(id, { code: 'record_id_conflict', id,
            destinationIds: [destination.id], timeRepositories: [destination.label || `${destination.owner}/${destination.repo}`] });
        }
        seen.set(id, destination.id);
      }
    }
  }
  for (const { destination, records } of results) {
    for (const catalog of records) {
      for (const task of catalog.tasks) {
        if (task.recordIds.some(id => duplicates.has(id))) continue;
        candidates.push({ taskUrl: task.taskUrl, title: task.title, destinationId: destination.id,
          timeRepository: destination.label || `${destination.owner}/${destination.repo}`,
          recordIds: task.recordIds, titleSourceId: task.titleSourceId });
      }
    }
  }
  return { records: taskCandidates(candidates.map(item => ({ ...item, taskTitle: item.title }))),
    indexTasks: candidates, conflicts: [...duplicates.values()], fallback: false };
}
