import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const bundle = new URL('../src/content/task-timeline-component.js', import.meta.url);
const before = readFileSync(bundle);
const build = spawnSync('npm', ['run', 'build:timeline'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);
if (!before.equals(readFileSync(bundle))) {
  console.error('Timeline bundle was out of date; include the rebuilt src/content/task-timeline-component.js.');
  process.exitCode = 1;
}
