import { normalizeIssue } from './values.js';

const PERIOD_DAYS = Object.freeze({
  'two-weeks': 14,
  'one-month': 31,
  'three-months': 92,
  'six-months': 181,
  'one-year': 365,
});

function dateValue(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function taskPeriodRange(period, today) {
  const days = PERIOD_DAYS[period];
  if (!days) throw new Error('Invalid task period');
  const match = typeof today === 'string' ? today.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) throw new Error('Invalid task period date');
  const end = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  if (Number.isNaN(end.getTime()) || dateValue(end) !== today) throw new Error('Invalid task period date');
  const start = new Date(end); start.setDate(start.getDate() - days + 1);
  return { startDate: dateValue(start), endDate: today };
}

export function effectiveTrackedSeconds(task, { active = null, now = Date.now() } = {}) {
  const completed = Number(task?.totalSeconds);
  if (!Number.isFinite(completed) || completed < 0) throw new Error('Invalid tracked task duration');
  if (!task.activeStartedAt || active?.issue?.url !== task.issue?.url) return completed;
  const startedAt = new Date(task.activeStartedAt).getTime(), current = new Date(now).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(current)) throw new Error('Invalid active task time');
  return completed + Math.max(0, Math.floor((current - startedAt) / 1000));
}

export function sortTrackedTasks(tasks, options = {}) {
  return [...(tasks ?? [])].sort((a, b) => effectiveTrackedSeconds(b, options) - effectiveTrackedSeconds(a, options)
    || a.issue.url.localeCompare(b.issue.url));
}

export function aggregateTrackedTasks(records, { user, metadata = new Map(), active = null } = {}) {
  if (typeof user !== 'string' || !user) throw new Error('Task owner is required');
  const tasks = new Map();
  for (const record of records ?? []) {
    if (record?.user !== user) continue;
    const issue = normalizeIssue(record.issue);
    const seconds = Number(record.durationSeconds);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid tracked task duration');
    const existing = tasks.get(issue.url) ?? { issue, totalSeconds: 0, sessionCount: 0 };
    const storedTitle = typeof record.issueTitle === 'string' ? record.issueTitle.trim().slice(0, 300) : '';
    if (storedTitle) existing.title = storedTitle;
    existing.totalSeconds += seconds; existing.sessionCount += 1; tasks.set(issue.url, existing);
  }
  if (active?.user === user) {
    const issue = normalizeIssue(active.issue), startedAt = new Date(active.startedAt);
    if (Number.isNaN(startedAt.getTime())) throw new Error('Invalid active task start time');
    const existing = tasks.get(issue.url) ?? { issue, totalSeconds: 0, sessionCount: 0 };
    existing.activeStartedAt = startedAt.toISOString(); tasks.set(issue.url, existing);
  }
  return [...tasks.values()].map(task => {
    const details = metadata.get(task.issue.url);
    const title = task.title || (task.activeStartedAt && typeof active?.issueTitle === 'string' && active.issueTitle.trim()
      ? active.issueTitle.trim().slice(0, 300)
      : (typeof details?.title === 'string' && details.title.trim()
        ? details.title.trim().slice(0, 300)
        : `${task.issue.owner}/${task.issue.repo}#${task.issue.number}`));
    const status = ['OPEN', 'CLOSED', 'MERGED'].includes(details?.status) ? details.status : 'UNKNOWN';
    const stateReason = task.issue.type === 'issue' && status === 'CLOSED' && ['COMPLETED', 'NOT_PLANNED'].includes(details?.stateReason)
      ? details.stateReason
      : null;
    return {
      issue: task.issue, title, status, totalSeconds: task.totalSeconds, sessionCount: task.sessionCount,
      ...(stateReason ? { stateReason } : {}),
      ...(task.activeStartedAt ? { activeStartedAt: task.activeStartedAt } : {}),
    };
  }).sort((a, b) => b.totalSeconds - a.totalSeconds || a.issue.url.localeCompare(b.issue.url));
}
