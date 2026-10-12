import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const load = `import importlib.util
spec = importlib.util.spec_from_file_location('safari', 'scripts/build-safari.py')
safari = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safari)
`;

test('Safari signing rejects each partially configured environment before invoking build tools', () => {
  execFileSync('python3', ['-B', '-c', `${load}
assert safari.signing_environment({}) is None
complete = {name: 'test-value' for name in safari.APPLE_ENV}
assert safari.signing_environment(complete) == complete
for missing in safari.APPLE_ENV:
    partial = {name: value for name, value in complete.items() if name != missing}
    try:
        safari.signing_environment(partial)
        raise AssertionError('Partial credentials accepted')
    except ValueError as error:
        assert missing in str(error)
`], { cwd: root });
  const environment = { ...process.env };
  for (const name of ['APPLE_TEAM_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8', 'APPLE_CERTIFICATES_P12_BASE64', 'APPLE_CERTIFICATES_PASSWORD']) delete environment[name];
  environment.APPLE_TEAM_ID = 'test-team';
  const result = spawnSync('python3', ['scripts/build-safari.py', '--build-number', '1', '/tmp/clockoli-partial-signing-test'], { cwd: root, env: environment, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Incomplete Apple signing environment; missing: ASC_KEY_ID/);
  assert.equal(result.stdout, '');
});

test('Safari ZIP preserves executable modes, framework symlinks, and deterministic inventory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clockoli-safari-test-'));
  try {
    execFileSync('python3', ['-B', '-c', `${load}
import pathlib, stat, sys, zipfile
root = pathlib.Path(sys.argv[1])
app = root / 'Clockoli.app'
executable = app / 'Contents/MacOS/Clockoli'
executable.parent.mkdir(parents=True)
executable.write_bytes(b'executable fixture')
executable.chmod(0o755)
link = app / 'Current'
link.symlink_to('Contents', target_is_directory=True)
one, two = root / 'one.zip', root / 'two.zip'
safari.zip_app(app, one)
safari.zip_app(app, two)
assert one.read_bytes() == two.read_bytes()
with zipfile.ZipFile(one) as archive:
    assert archive.namelist() == sorted(archive.namelist())
    assert archive.read('Clockoli.app/Current') == b'Contents'
    assert stat.S_ISLNK(archive.getinfo('Clockoli.app/Current').external_attr >> 16)
    assert archive.getinfo('Clockoli.app/Contents/MacOS/Clockoli').external_attr >> 16 & 0o777 == 0o755
    assert all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in archive.infolist())
`, directory], { cwd: root });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
