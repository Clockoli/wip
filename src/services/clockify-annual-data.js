function instant(value) {
  if (typeof value !== 'string') return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Ensures a normalized, capturing-phase annual export cannot be attributed to
 * a different report year after Clockify's SPA has navigated the tab. */
export function assertClockifyAnnualDataYear(data, year) {
  if (!Number.isInteger(year) || year < 0 || year > 9999) throw new Error('Clockify annual capture year is invalid');
  if (!Array.isArray(data?.entries)) throw new Error('Clockify annual capture data is invalid');
  if (data.entries.length === 0) return;
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  for (const entry of data.entries) {
    const startedAt = instant(entry?.startedAt);
    const endedAt = instant(entry?.endedAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt || startedAt >= end || endedAt <= start) {
      throw new Error('Clockify annual capture data does not match the requested year');
    }
  }
}
