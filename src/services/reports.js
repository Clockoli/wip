import { parseDailyText, parseDailyTextPath } from '../domain/daily-text.js';
import { validateDateRange } from '../domain/reporting.js';

function withoutStorageMetadata(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('_')));
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length); let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next; next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export class ReportService {
  constructor({ github, concurrency = 6 }) {
    this.github = github;
    this.concurrency = Math.min(12, Math.max(1, Number(concurrency) || 6));
  }

  async loadRange({ startDate, endDate }) {
    validateDateRange(startDate, endDate);
    const files = (await this.github.listTextFiles('times/')).map(file => {
      try { return { ...file, ...parseDailyTextPath(file.path) }; }
      catch { return null; }
    }).filter(file => file && file.date >= startDate && file.date <= endDate)
      .sort((a, b) => a.path.localeCompare(b.path));
    const batches = await mapConcurrent(files, this.concurrency, async file => {
      const blob = await this.github.getBlobText(file.path, file.sha);
      try {
        return parseDailyText(blob.text, { user: file.user, date: file.date, path: file.path, sha: file.sha }).map(withoutStorageMetadata);
      } catch (error) {
        throw new Error(`Invalid time data in ${file.path}: ${error?.message || error}`, { cause: error });
      }
    });
    return batches.flat().sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt) || a.user.localeCompare(b.user));
  }
}
