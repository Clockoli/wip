const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIMENSIONS = new Set(['person', 'repository', 'issue']);
const INTERVALS = new Set(['day', 'week', 'month']);

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

function repository(record) { return `${record.issue.owner}/${record.issue.repo}`; }
function selected(values) { return values instanceof Set ? values : new Set(values ?? []); }

export function filterReportRecords(records, filters = {}) {
  const people = selected(filters.people), repositories = selected(filters.repositories);
  return (records ?? []).filter(record => (!people.size || people.has(record.user)) && (!repositories.size || repositories.has(repository(record))));
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

function bucketKey(record, interval) {
  const date = record.entryDate || record.startedAt.slice(0, 10);
  if (!interval) return 'total';
  if (interval === 'day') return date;
  if (interval === 'month') return date.slice(0, 7);
  const { date: parsed } = dateParts(date), offset = (parsed.getUTCDay() + 6) % 7;
  return addDays(date, -offset);
}

function bucketLabel(key, interval) {
  if (!interval) return 'Total';
  if (interval === 'week') return `Week of ${key}`;
  if (interval === 'month') {
    const [year, month] = key.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
  }
  return key;
}

function dimensionPart(record, dimension) {
  if (dimension === 'person') return { key: record.user, label: record.user };
  if (dimension === 'repository') return { key: repository(record), label: repository(record) };
  const type = record.issue.type === 'pull_request' ? 'PR' : 'Issue';
  return { key: record.issue.url, label: `${record.issue.owner}/${record.issue.repo}#${record.issue.number} (${type})` };
}

export function buildAnalytics(records, options = {}) {
  const dimensions = [...new Set(options.dimensions ?? [])].filter(value => DIMENSIONS.has(value));
  const interval = options.interval == null ? null : options.interval;
  if (interval !== null && !INTERVALS.has(interval)) throw new Error('Invalid analytics interval');
  const buckets = new Map(), series = new Map();
  for (const record of records ?? []) {
    const bucket = bucketKey(record, interval), parts = dimensions.map(dimension => dimensionPart(record, dimension));
    const seriesKey = parts.length ? parts.map(part => part.key).join('\u001f') : 'total';
    const seriesLabel = parts.length ? parts.map(part => part.label).join(' · ') : 'Total';
    series.set(seriesKey, { key: seriesKey, label: seriesLabel });
    const item = buckets.get(bucket) ?? { key: bucket, label: bucketLabel(bucket, interval), totalSeconds: 0, values: new Map() };
    const seconds = Math.max(0, Number(record.durationSeconds) || 0);
    item.totalSeconds += seconds; item.values.set(seriesKey, (item.values.get(seriesKey) ?? 0) + seconds); buckets.set(bucket, item);
  }
  const seriesList = [...series.values()].sort((a, b) => a.label.localeCompare(b.label));
  const bucketList = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map(bucket => ({
    key: bucket.key, label: bucket.label, totalSeconds: bucket.totalSeconds,
    segments: seriesList.filter(item => bucket.values.has(item.key)).map(item => ({ ...item, seconds: bucket.values.get(item.key) })),
  }));
  return { series: seriesList, buckets: bucketList, maxSeconds: Math.max(0, ...bucketList.map(item => item.totalSeconds)) };
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

export function exportTimesheet(records, { format, startDate, endDate }) {
  validateDateRange(startDate, endDate);
  const ordered = sortedRecords(records), total = ordered.reduce((sum, record) => sum + (Number(record.durationSeconds) || 0), 0);
  if (format === 'csv') {
    const rows = [['Person', 'Repository', 'Type', 'Number', 'URL', 'Start', 'End', 'Duration', 'Duration seconds', 'Description']];
    for (const record of ordered) rows.push([
      record.user, repository(record), record.issue.type === 'pull_request' ? 'Pull request' : 'Issue', record.issue.number,
      record.issue.url, record.startedAt, record.endedAt, hms(record.durationSeconds), record.durationSeconds, record.description || '',
    ]);
    return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }
  if (format !== 'text') throw new Error('Unknown timesheet format');
  const lines = [`Timesheet: ${startDate} to ${endDate}`, `Total: ${formatClockDuration(total, { zeroPadMinutes: true })}`, ''];
  ordered.forEach((record, index) => {
    lines.push(`Person: ${record.user}`, `Repository: ${repository(record)}`, `Item: ${record.issue.type === 'pull_request' ? 'Pull request' : 'Issue'} #${record.issue.number}`,
      `URL: ${record.issue.url}`, `Start: ${record.startedAt}`, `End: ${record.endedAt}`, `Duration: ${hms(record.durationSeconds)}`);
    if (record.description) lines.push(`Description: ${record.description}`);
    if (index < ordered.length - 1) lines.push('');
  });
  return `${lines.join('\n')}\n`;
}

export function reportFilename(format, startDate, endDate) {
  validateDateRange(startDate, endDate);
  if (!['csv', 'text'].includes(format)) throw new Error('Unknown timesheet format');
  return `timesheet-${startDate}-to-${endDate}.${format === 'csv' ? 'csv' : 'txt'}`;
}
