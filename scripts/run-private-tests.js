import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const privateRoot = path.join(root, 'test-private');
let files;
try {
  const metadata = JSON.parse(readFileSync(path.join(privateRoot, 'package.json'), 'utf8'));
  if (metadata.name !== 'clockoli-private-tests' || metadata.private !== true) throw new Error('unexpected private suite');
  files = readdirSync(privateRoot);
} catch {
  console.error('Clone Clockoli/tests-private into test-private/ before running the private suite.');
  process.exit(1);
}

const flags = process.argv.slice(2);
if (flags.some(flag => !['--unit', '--browser'].includes(flag)) || (flags.includes('--unit') && flags.includes('--browser'))) {
  console.error('Usage: npm run test:private [-- --unit | -- --browser]');
  process.exit(1);
}
const runUnit = !flags.includes('--browser');
const runBrowser = !flags.includes('--unit');
const run = (program, args) => {
  const result = spawnSync(program, args, {
    cwd: root, env: { ...process.env, TZ: 'UTC' }, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};

if (runUnit) {
  const tests = files.filter(file => file.endsWith('.test.js')).sort().map(file => path.join(privateRoot, file));
  if (!tests.length) throw new Error('Private Node suite is empty');
  run(process.execPath, ['--test', ...tests]);
}
if (runBrowser) {
  run('npm', ['exec', '--', 'playwright', 'test', '--config', 'test-private/playwright.config.js']);
}
