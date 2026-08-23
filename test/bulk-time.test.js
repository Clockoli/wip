import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkTimeText } from '../src/domain/bulk-time.js';

test('bulk time text accepts supported date and hour formats with URL-delimited descriptions', () => {
  assert.deepEqual(parseBulkTimeText(`
2026/08/21 https://example.com/a Search relevance work 6:00
2026-08-22 https://example.com/b 6.5
23.08.2026 https://example.com/c Customer call 1:30
24/08/2026 https://example.com/d Release 0.25
`), [
    { line: 2, date: '2026-08-21', taskUrl: 'https://example.com/a', description: 'Search relevance work', durationSeconds: 21600 },
    { line: 3, date: '2026-08-22', taskUrl: 'https://example.com/b', description: '', durationSeconds: 23400 },
    { line: 4, date: '2026-08-23', taskUrl: 'https://example.com/c', description: 'Customer call', durationSeconds: 5400 },
    { line: 5, date: '2026-08-24', taskUrl: 'https://example.com/d', description: 'Release', durationSeconds: 900 },
  ]);
});

test('bulk time decimal hundredths convert to exact whole seconds without floating-point rejection', () => {
  assert.deepEqual(
    parseBulkTimeText(`2026-08-21 https://example.com/a Seven hundredths 0.07
2026-08-22 https://example.com/b Comma hundredths 0,07
2026-08-23 https://example.com/c Fourteen hundredths 0.14`)
      .map(entry => entry.durationSeconds),
    [252, 252, 504],
  );
});

test('bulk time parser rejects ambiguous, unsafe, zero, oversized, and malformed lines with the line number', () => {
  assert.throws(() => parseBulkTimeText('08/09/2026 https://example.com/a work 1'), /Line 1.*date format/i);
  assert.throws(() => parseBulkTimeText('2026-08-21 javascript:alert(1) work 1'), /Line 1.*HTTP\(S\).*URL/i);
  assert.throws(() => parseBulkTimeText('2026-08-21 https://example.com/a work 0'), /Line 1.*greater than zero/i);
  assert.throws(() => parseBulkTimeText('2026-08-21 https://example.com/a work 24:01'), /Line 1.*24 hours/i);
  assert.throws(() => parseBulkTimeText('2026-02-30 https://example.com/a work 1'), /Line 1.*date/i);
  assert.throws(() => parseBulkTimeText('0001-02-02 https://example.com/a work 1'), /Line 1.*1970-9999/i);
  assert.throws(() => parseBulkTimeText(''), /at least one/i);
});
