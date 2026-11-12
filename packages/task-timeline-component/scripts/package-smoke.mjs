import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const repository = resolve(root, '../..');
const artifact = resolve(repository, 'src/content/task-timeline-component.js');
const source = await readFile(artifact, 'utf8');
if (!source.includes('global.TaskTimeline = TaskTimeline')) throw new Error('TaskTimeline export is missing');
if (!source.includes('global.ClockoliTaskTimeline =')) throw new Error('Clockoli adapter export is missing');
const directory = await mkdtemp(join(tmpdir(), 'clockoli-task-timeline-'));
try {
  const copy = join(directory, 'task-timeline-component.js');
  await import('node:fs/promises').then(({ writeFile }) => writeFile(copy, source));
  const checked = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(checked.stderr || checked.stdout || 'node --check failed');
  console.log('TaskTimeline consumer smoke passed.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
