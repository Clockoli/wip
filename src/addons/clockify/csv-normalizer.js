const HEADER = ['Project', 'Client', 'Description', 'Task', 'User', 'Group', 'Email', 'Tags', 'Billable', 'Start Date', 'Start Time', 'End Date', 'End Time', 'Duration (h)', 'Duration (decimal)', 'Billable Rate (0)', 'Billable Amount (0)', 'Date of creation'];
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_TEXT = 2_000;

function fail(message) { throw new Error(`Invalid Clockify Detailed CSV: ${message}`); }
function text(value, label, maximum = MAX_TEXT, empty = true) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value)) fail(`invalid ${label}`);
  return value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function parseCsv(source) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += char; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') { if (field) fail('unexpected quote'); quoted = true; }
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.length !== 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) fail('unterminated quoted field');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function dateTime(dateText, timeText) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i.exec(`${dateText} ${timeText}`);
  if (!match) fail('invalid local timestamp');
  const [, month, day, year, hour, minute, meridiem] = match;
  if (Number(hour) < 1 || Number(hour) > 12 || Number(minute) > 59) fail('invalid local timestamp');
  const hours = (Number(hour) % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  const value = new Date(Number(year), Number(month) - 1, Number(day), hours, Number(minute), 0, 0);
  if (value.getFullYear() !== Number(year) || value.getMonth() !== Number(month) - 1 || value.getDate() !== Number(day) || value.getHours() !== hours || value.getMinutes() !== Number(minute)) fail('invalid local timestamp');
  return value;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Parses the exact native Clockify Detailed Report CSV schema. Dates are rendered
 * by Clockify in the browser's current local timezone, so timestamps intentionally
 * use that same timezone rather than guessing from an export filename. */
export async function normalizeClockifyDetailedCsv(csvText, { profile = false, onProgress = null } = {}) {
  if (typeof csvText !== 'string') fail('CSV must be text');
  if (onProgress !== null && typeof onProgress !== 'function') fail('progress callback must be a function');
  const startedAt = performance.now();
  if (new TextEncoder().encode(csvText).byteLength > MAX_BYTES) fail('CSV is too large');
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ''));
  const parsedAt = performance.now();
  if (!rows.length || JSON.stringify(rows[0]) !== JSON.stringify(HEADER)) fail('unsupported CSV header');
  const totalRows = rows.length - 1;
  const reportProgress = completedRows => onProgress?.({ completedRows, totalRows });
  reportProgress(0);
  const sourceDigest = await sha256(csvText);
  const digestedAt = performance.now();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof timezone !== 'string' || !timezone) fail('browser timezone is unavailable');
  const users = new Map();
  const entries = [];
  const rowOccurrences = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.length !== HEADER.length) fail(`row ${index} has ${row.length} columns`);
    const value = Object.fromEntries(HEADER.map((name, column) => [name, row[column]]));
    const email = text(value.Email, 'email', 300, false).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`row ${index} has invalid email`);
    const displayName = text(value.User, 'user', 300, false);
    const start = dateTime(value['Start Date'], value['Start Time']);
    const end = dateTime(value['End Date'], value['End Time']);
    const durationMatch = /^(\d+):(\d{2})$/.exec(value['Duration (h)']);
    if (!durationMatch || Number(durationMatch[2]) > 59) fail(`row ${index} has invalid duration`);
    const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60;
    if (end.getTime() < start.getTime() || (end.getTime() === start.getTime() && duration !== 0) || duration !== Math.round((end - start) / 1000)) fail(`row ${index} has inconsistent interval`);
    if (end.getTime() === start.getTime()) {
      if (index === totalRows || index % 100 === 0) {
        reportProgress(index);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      continue;
    }
    const userId = `csv-user:${await sha256(email)}`;
    const project = text(value.Project, 'project', 300, false);
    const projectId = `csv-project:${await sha256(project.toLowerCase())}`;
    const tags = [...new Set(text(value.Tags, 'tags', 2_000).split(',').map(tag => tag.trim()).filter(Boolean))];
    if (!['Yes', 'No'].includes(value.Billable)) fail(`row ${index} has invalid billable marker`);
    const rowDigest = await sha256(JSON.stringify(row));
    const occurrence = (rowOccurrences.get(rowDigest) ?? 0) + 1;
    rowOccurrences.set(rowDigest, occurrence);
    const entry = {
      provider: 'clockify', entryId: `csv-v2:${rowDigest}:${occurrence}`, userId,
      startedAt: start.toISOString(), endedAt: end.toISOString(), timezone, duration,
      projectId, project, task: text(value.Task, 'task', 300), description: text(value.Description, 'description'), tags,
      billable: value.Billable === 'Yes',
    };
    entries.push(entry);
    const user = users.get(userId);
    if (user && user.displayName !== displayName) fail(`row ${index} has conflicting user`);
    if (user) user.entryCount += 1;
    else users.set(userId, { userId, displayName, entryCount: 1 });
    if (index === totalRows || index % 100 === 0) {
      reportProgress(index);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (totalRows === 0) reportProgress(0);
  const data = { users: [...users.values()], entries };
  if (!profile) return data;
  const completedAt = performance.now();
  return {
    data,
    profile: {
      byteCount: new TextEncoder().encode(csvText).byteLength,
      rowCount: rows.length - 1,
      parseMs: parsedAt - startedAt,
      sourceDigestMs: digestedAt - parsedAt,
      normalizeRowsMs: completedAt - digestedAt,
      totalMs: completedAt - startedAt,
    },
  };
}
