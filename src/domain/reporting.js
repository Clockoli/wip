import { parseGitHubTaskUrl, taskUrlOf } from './values.js';
import { billableMinorForRecord, rateForUser } from './local-settings.js';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const AXES = new Set(['day', 'week', 'month', 'person', 'repository', 'task']);
const METRICS = new Set(['total-time', 'avg-time', 'task-count', 'billable-amount']);
const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const MONTH_LABELS = new Map();

function dateParts(value) {
  const match = String(value ?? '').match(DATE_RE);
  if (!match) throw new Error('Enter a valid date');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('Enter a valid date');
  return { year, month, day, date };
}

function dateValue(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(value, days) {
  const { date } = dateParts(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateValue(date);
}

function monthRange(year, month) {
  return {
    startDate: dateValue(new Date(Date.UTC(year, month - 1, 1))),
    endDate: dateValue(new Date(Date.UTC(year, month, 0))),
  };
}

export function validateDateRange(startDate, endDate) {
  dateParts(startDate); dateParts(endDate);
  if (endDate < startDate) throw new Error('End date must be on or after Start date');
  return { startDate, endDate };
}

export function periodRange(preset, today, custom = {}) {
  const { year, month, date } = dateParts(today);
  let range, label;
  if (preset === 'custom') {
    range = validateDateRange(custom.startDate, custom.endDate); label = 'Custom period';
  } else if (preset === 'this-week' || preset === 'last-week') {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    const monday = addDays(today, -mondayOffset + (preset === 'last-week' ? -7 : 0));
    range = { startDate: monday, endDate: addDays(monday, 6) }; label = preset === 'this-week' ? 'This week' : 'Last week';
  } else if (preset === 'this-month' || preset === 'last-month') {
    const target = new Date(Date.UTC(year, month - 1 + (preset === 'last-month' ? -1 : 0), 1));
    range = monthRange(target.getUTCFullYear(), target.getUTCMonth() + 1); label = preset === 'this-month' ? 'This month' : 'Last month';
  } else if (preset === 'this-quarter' || preset === 'last-quarter') {
    const currentStart = Math.floor((month - 1) / 3) * 3;
    const target = new Date(Date.UTC(year, currentStart + (preset === 'last-quarter' ? -3 : 0), 1));
    const startMonth = target.getUTCMonth() + 1, targetYear = target.getUTCFullYear();
    range = { startDate: monthRange(targetYear, startMonth).startDate, endDate: monthRange(targetYear, startMonth + 2).endDate };
    label = preset === 'this-quarter' ? 'This quarter' : 'Last quarter';
  } else if (preset === 'this-year' || preset === 'last-year') {
    const targetYear = year + (preset === 'last-year' ? -1 : 0);
    range = { startDate: `${targetYear}-01-01`, endDate: `${targetYear}-12-31` }; label = preset === 'this-year' ? 'This year' : 'Last year';
  } else {
    throw new Error('Unknown report period');
  }
  return { ...validateDateRange(range.startDate, range.endDate), label };
}

export function formatClockDuration(seconds, { zeroPadMinutes = false } = {}) {
  const totalMinutes = Math.max(0, Math.round(Number(seconds) / 60) || 0);
  const hours = Math.floor(totalMinutes / 60), minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  return `${hours}h ${zeroPadMinutes ? String(minutes).padStart(2, '0') : minutes}m`;
}

export function todayTrackedSeconds(records, active, now = new Date(), today = null) {
  const current = today ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let total = (records ?? []).filter(record => (record.entryDate || record.startedAt?.slice(0, 10)) === current)
    .reduce((sum, record) => sum + Math.max(0, Number(record.durationSeconds) || 0), 0);
  if (active?.startedAt?.slice(0, 10) === current) total += Math.max(0, Math.floor((now.getTime() - new Date(active.startedAt).getTime()) / 1000));
  return total;
}

export function taskSource(record) {
  const taskUrl = taskUrlOf(record), issue = record.issue ?? parseGitHubTaskUrl(taskUrl);
  return issue ? `${issue.owner}/${issue.repo}` : new URL(taskUrl).hostname;
}
function repository(record) { return taskSource(record); }
function selected(values) { return values instanceof Set ? values : new Set(values ?? []); }

export function filterReportRecords(records, filters = {}) {
  const people = selected(filters.people), repositories = selected(filters.repositories);
  const peopleMatch = record => people.size ? people.has(record.user) : !filters.emptyMeansNone;
  const repositoryMatch = record => repositories.size ? repositories.has(repository(record)) : !filters.emptyMeansNone;
  return (records ?? []).filter(record => peopleMatch(record) && repositoryMatch(record));
}

function facet(records, key) {
  const totals = new Map();
  for (const record of records) {
    const value = key(record), current = totals.get(value) ?? { value, count: 0, seconds: 0 };
    current.count += 1; current.seconds += Number(record.durationSeconds) || 0; totals.set(value, current);
  }
  return [...totals.values()].sort((a, b) => a.value.localeCompare(b.value));
}

export function buildFacets(records, filters = {}) {
  const people = selected(filters.people), repositories = selected(filters.repositories);
  return {
    people: facet((records ?? []).filter(record => !repositories.size || repositories.has(repository(record))), record => record.user),
    repositories: facet((records ?? []).filter(record => !people.size || people.has(record.user)), repository),
  };
}

function recordDate(record) { return record.entryDate || record.startedAt.slice(0, 10); }

function taskPart(record) {
  const taskUrl = taskUrlOf(record), title = String(record.taskTitle ?? record.issueTitle ?? '').trim();
  return { key: taskUrl, label: title ? `${taskUrl} · ${title}` : taskUrl };
}

function axisPart(record, axis) {
  const date = recordDate(record);
  if (axis === 'day') return { key: date, label: date };
  if (axis === 'week') {
    const { date: parsed } = dateParts(date), offset = (parsed.getUTCDay() + 6) % 7, key = addDays(date, -offset);
    return { key, label: `Week of ${key}` };
  }
  if (axis === 'month') {
    const key = date.slice(0, 7);
    if (!MONTH_LABELS.has(key)) {
      const [year, month] = key.split('-').map(Number);
      MONTH_LABELS.set(key, MONTH_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1))));
    }
    return { key, label: MONTH_LABELS.get(key) };
  }
  if (axis === 'person') return { key: record.user, label: record.user };
  if (axis === 'repository') return { key: repository(record), label: repository(record) };
  return taskPart(record);
}

function metricValue(metric, seconds, count, billableMinor = 0) {
  if (metric === 'task-count') return count;
  if (metric === 'avg-time') return count ? seconds / count : 0;
  if (metric === 'billable-amount') return billableMinor;
  return seconds;
}

function segmentValue(metric, aggregate, bucketTaskCount) {
  if (metric === 'avg-time') return bucketTaskCount ? aggregate.seconds / bucketTaskCount : 0;
  return metricValue(metric, aggregate.seconds, aggregate.taskCount, aggregate.billableMinor);
}

export function buildAnalytics(records, options = {}) {
  const metric = options.metric ?? 'total-time';
  const horizontalAxis = options.horizontalAxis ?? 'week';
  const stackBy = options.stackBy ?? 'person';
  if (!METRICS.has(metric)) throw new Error('Invalid analytics metric');
  if (!AXES.has(horizontalAxis)) throw new Error('Invalid horizontal axis');
  if (!AXES.has(stackBy)) throw new Error('Invalid stack dimension');
  const buckets = new Map(), series = new Map();
  let billableCurrency = options.currency || '';
  for (const record of records ?? []) {
    const recordDate = record.entryDate || String(record.startedAt || '').slice(0, 10);
    const recordRate = rateForUser(record.user, options.rates || {}, recordDate);
    if (metric === 'billable-amount') {
      if (!recordRate) continue;
      if (!billableCurrency) billableCurrency = recordRate.currency;
      if (recordRate.currency !== billableCurrency) {
        if (!options.currency) throw new Error('Select one currency for billable analytics');
        continue;
      }
    }
    const bucketPart = axisPart(record, horizontalAxis), seriesPart = axisPart(record, stackBy);
    series.set(seriesPart.key, seriesPart);
    const bucket = buckets.get(bucketPart.key) ?? { ...bucketPart, values: new Map() };
    const cell = bucket.values.get(seriesPart.key) ?? { seconds: 0, count: 0, billableMinor: 0, tasks: new Set() };
    cell.seconds += Math.max(0, Number(record.durationSeconds) || 0); cell.count += 1;
    cell.billableMinor += billableMinorForRecord(record, options.rates || {}); cell.tasks.add(taskUrlOf(record));
    bucket.values.set(seriesPart.key, cell); buckets.set(bucketPart.key, bucket);
  }
  const seriesList = [...series.values()].sort((a, b) => a.label.localeCompare(b.label));
  const bucketList = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map(bucket => {
    const bucketTasks = new Set(), bucketSeconds = [...bucket.values.values()].reduce((sum, aggregate) => {
      for (const task of aggregate.tasks) bucketTasks.add(task);
      return sum + aggregate.seconds;
    }, 0);
    const segments = [...bucket.values.entries()].map(([key, aggregate]) => {
      const item = series.get(key), taskCount = aggregate.tasks.size;
      return {
        ...item, seconds: aggregate.seconds, count: aggregate.count, taskCount, billableMinor: aggregate.billableMinor,
        averageValue: metricValue('avg-time', aggregate.seconds, taskCount),
        value: segmentValue(metric, { ...aggregate, taskCount }, bucketTasks.size),
      };
    }).sort((a, b) => a.label.localeCompare(b.label));
    const totalValue = ['task-count', 'billable-amount'].includes(metric)
      ? segments.reduce((sum, segment) => sum + segment.value, 0)
      : metricValue(metric, bucketSeconds, bucketTasks.size);
    return { key: bucket.key, label: bucket.label, totalValue, segments };
  });
  return {
    metric, horizontalAxis, stackBy, currency: billableCurrency, series: seriesList, buckets: bucketList,
    maxValue: Math.max(0, ...bucketList.map(item => item.totalValue)),
  };
}

function sortedRecords(records) { return [...(records ?? [])].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt) || a.user.localeCompare(b.user)); }
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@-]/.test(text) || text.startsWith('\t') || text.startsWith('\r')) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function hms(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return [Math.floor(value / 3600), Math.floor(value % 3600 / 60), value % 60].map(item => String(item).padStart(2, '0')).join(':');
}

export function buildPrintableTimesheet(records) {
  const detail = new Map(), tasks = new Map();
  for (const record of records ?? []) {
    const date = recordDate(record), person = String(record.user || ''), url = taskUrlOf(record);
    const repositoryName = repository(record);
    const title = String(record.taskTitle ?? record.issueTitle ?? '').trim();
    const number = record.issue?.number;
    const task = number ? `#${number}${title ? ` ${title}` : ''}` : title ? `${title} — ${url}` : url;
    const seconds = Math.max(0, Number(record.durationSeconds) || 0);
    const detailKey = JSON.stringify([date, person, url]);
    const detailRow = detail.get(detailKey) ?? { date, person, repository: repositoryName, task, url, seconds: 0 };
    detailRow.seconds += seconds; detail.set(detailKey, detailRow);
    const taskRow = tasks.get(url) ?? { repository: repositoryName, task, url, seconds: 0 };
    taskRow.seconds += seconds; tasks.set(url, taskRow);
  }
  const byDate = [...detail.values()].sort((a, b) => a.date.localeCompare(b.date)
    || a.person.localeCompare(b.person) || a.task.localeCompare(b.task) || a.url.localeCompare(b.url));
  const byTask = [...tasks.values()].sort((a, b) => b.seconds - a.seconds
    || a.task.localeCompare(b.task) || a.url.localeCompare(b.url));
  return { byDate, byTask, totalSeconds: byDate.reduce((sum, row) => sum + row.seconds, 0) };
}

export function exportTimesheet(records, { format, startDate, endDate, rates = null }) {
  validateDateRange(startDate, endDate);
  const ordered = sortedRecords(records), totalSeconds = ordered.reduce((sum, record) => sum + (Number(record.durationSeconds) || 0), 0);
  const entries = ordered.map(record => {
    const rate = rates ? rateForUser(record.user, rates, record.entryDate || record.startedAt.slice(0, 10)) : null;
    return {
      person: record.user,
      repository: repository(record),
      type: record.issue?.type === 'pull_request' ? 'Pull request' : record.issue?.type === 'issue' ? 'Issue' : 'URL',
      number: record.issue?.number ?? '',
      url: taskUrlOf(record),
      start: record.startedAt,
      end: record.endedAt,
      duration: hms(record.durationSeconds),
      durationSeconds: record.durationSeconds,
      ...(rates ? {
        hourlyRate: rate ? (rate.amountMinorPerHour / 100).toFixed(2) : '',
        billableAmount: rate ? (billableMinorForRecord(record, rates) / 100).toFixed(2) : '',
        currency: rate?.currency || '',
      } : {}),
      description: record.description || '',
    };
  });
  if (format === 'csv') {
    const rows = [rates
      ? ['Person', 'Repository', 'Type', 'Number', 'URL', 'Start', 'End', 'Duration', 'Duration seconds', 'Hourly rate', 'Billable amount', 'Currency', 'Description']
      : ['Person', 'Repository', 'Type', 'Number', 'URL', 'Start', 'End', 'Duration', 'Duration seconds', 'Description']];
    for (const entry of entries) rows.push(Object.values(entry));
    return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }
  if (format === 'json') return `${JSON.stringify({ period: { startDate, endDate }, totalSeconds, entries }, null, 2)}\n`;
  throw new Error('Unknown timesheet format');
}

export function reportFilename(format, startDate, endDate) {
  validateDateRange(startDate, endDate);
  if (!['csv', 'json'].includes(format)) throw new Error('Unknown timesheet format');
  return `timesheet-${startDate}-to-${endDate}.${format}`;
}
