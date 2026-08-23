import { normalizeTaskUrl } from './values.js';

function isoDate(year, month, day, line) {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const maximum = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > maximum) throw new Error(`Line ${line}: invalid date (use 1970-9999)`);
  return value;
}

function parseDate(value, line) {
  let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]), line);
  match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]), line);
  match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const first = Number(match[1]), second = Number(match[2]);
    if (first <= 12 && second <= 12) throw new Error(`Line ${line}: ambiguous date format; use YYYY-MM-DD, YYYY/MM/DD, or DD.MM.YYYY`);
    if (first > 12) return isoDate(Number(match[3]), second, first, line);
    return isoDate(Number(match[3]), first, second, line);
  }
  throw new Error(`Line ${line}: unsupported date format`);
}

function parseDuration(value, line) {
  const clock = value.match(/^(\d{1,2}):(\d{2})$/);
  let seconds;
  if (clock) {
    const hours = Number(clock[1]), minutes = Number(clock[2]);
    if (minutes > 59) throw new Error(`Line ${line}: invalid hours value`);
    seconds = hours * 3600 + minutes * 60;
  } else {
    const decimal = value.match(/^(\d{1,2})(?:[.,](\d{1,2}))?$/);
    if (decimal) {
      const hours = Number(decimal[1]), hundredths = Number((decimal[2] || '').padEnd(2, '0'));
      seconds = hours * 3600 + hundredths * 36;
    } else {
      throw new Error(`Line ${line}: hours must use H:MM or decimal hours such as 6.5`);
    }
  }
  if (!Number.isSafeInteger(seconds)) throw new Error(`Line ${line}: hours must resolve to whole seconds`);
  if (seconds <= 0) throw new Error(`Line ${line}: hours must be greater than zero`);
  if (seconds > 24 * 3600) throw new Error(`Line ${line}: one entry cannot exceed 24 hours`);
  return seconds;
}

export function parseBulkTimeText(text, { maxEntries = 500 } = {}) {
  const source = String(text ?? '');
  if (source.length > 256 * 1024) throw new Error('Bulk input is too large');
  const entries = [];
  for (const [offset, raw] of source.split(/\r?\n/).entries()) {
    const line = offset + 1, value = raw.trim();
    if (!value) continue;
    const parts = value.split(/\s+/);
    if (parts.length < 3) throw new Error(`Line ${line}: expected date, URL, optional description, and hours`);
    const date = parseDate(parts[0], line), rawUrl = parts[1], durationSeconds = parseDuration(parts.at(-1), line);
    let taskUrl;
    try { taskUrl = normalizeTaskUrl(rawUrl); } catch { throw new Error(`Line ${line}: enter a valid HTTP(S) URL without spaces`); }
    const description = parts.slice(2, -1).join(' ').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
    if (description.length > 2000) throw new Error(`Line ${line}: description exceeds 2000 characters`);
    entries.push({ line, date, taskUrl, description, durationSeconds });
    if (entries.length > maxEntries) throw new Error(`Bulk input cannot contain more than ${maxEntries} entries`);
  }
  if (!entries.length) throw new Error('Enter at least one time entry');
  return entries;
}
