import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import webExt from 'web-ext';

const root = path.resolve(import.meta.dirname, '..');
const [command, output] = process.argv.slice(2);
if (!['lint', 'sign'].includes(command) || (command === 'sign' && !output)) {
  throw new Error('Usage: node scripts/firefox.js lint | sign OUTPUT_DIRECTORY');
}
if (command === 'sign') {
  for (const name of ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET']) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
  }
  const relative = path.relative(root, path.resolve(output));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Signing output must be outside the repository');
  }
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'clockoli-firefox-'));
try {
  const sourceDir = path.join(temporary, 'extension');
  execFileSync('python3', ['scripts/build-release.py', '--target', 'firefox', '--unpacked', sourceDir], { cwd: root, stdio: 'inherit' });
  if (command === 'lint') {
    execFileSync(process.execPath, [path.join(root, 'node_modules/web-ext/bin/web-ext.js'), 'lint', '--source-dir', sourceDir, '--artifacts-dir', temporary], { cwd: root, stdio: 'inherit' });
  } else {
    const artifactsDir = path.resolve(output);
    await mkdir(artifactsDir, { recursive: true });
    const sourceArchive = path.join(temporary, 'source.zip');
    execFileSync('git', ['archive', '--format=zip', `--output=${sourceArchive}`, 'HEAD'], { cwd: root });
    const result = await webExt.cmd.sign({ sourceDir, artifactsDir: temporary, channel: 'unlisted',
      apiKey: process.env.AMO_JWT_ISSUER, apiSecret: process.env.AMO_JWT_SECRET, uploadSourceCode: sourceArchive,
    });
    if (result.downloadedFiles.length !== 1) throw new Error('AMO signing did not produce a signed extension');
    const files = (await readdir(temporary)).filter(file => file.endsWith('.xpi'));
    if (files.length !== 1) throw new Error('AMO signing must produce exactly one signed XPI');
    const { version } = JSON.parse(await readFile(path.join(sourceDir, 'manifest.json'), 'utf8'));
    const destination = path.join(artifactsDir, `Clockoli-${version}-firefox-signed.xpi`);
    await copyFile(path.join(temporary, files[0]), destination);
    const bytes = await readFile(destination);
    console.log(JSON.stringify({ path: destination, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
