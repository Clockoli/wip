import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('public test commands remain runnable without private repository access', () => {
  const root = JSON.parse(read('package.json'));
  const timeline = JSON.parse(read('packages/task-timeline-component/package.json'));
  assert.equal(root.scripts.test, 'npm run test:clockoli && npm run test:timeline');
  assert.equal(root.scripts['test:clockoli'], 'node --test test/*.test.js');
  assert.equal(root.scripts['test:browser'], 'playwright test test/basic-browser.functional.spec.js --workers=1');
  assert.equal(root.scripts['test:private'], 'node scripts/run-private-tests.js');
  assert.equal(root.scripts['test:timeline'], 'node scripts/verify-timeline-build.js && npm run test:all --workspace task-timeline-component-clockoli');
  assert.equal(timeline.scripts['test:all'], 'npm test && npm run test:package');
  assert.deepEqual(readdirSync(new URL('../test/', import.meta.url)).filter(name => name.endsWith('.functional.spec.js')),
    ['basic-browser.functional.spec.js']);
});

test('public CI runs private regressions only for trusted main without exposing the suite in logs', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /pull_request:/);
  assert.doesNotMatch(ci, /pull_request_target:/);
  const [publicJobs, privateJob] = ci.split(/\n  private-regressions:\n/);
  assert.ok(privateJob, 'a separate private test job is required');
  assert.doesNotMatch(publicJobs, /tests-private|test-private|secrets\./);
  assert.match(publicJobs, /npm test/);
  assert.match(publicJobs, /npm run check/);
  assert.match(privateJob, /needs: test/);
  assert.match(privateJob, /if:.*github\.event_name == 'push'.*github\.ref == 'refs\/heads\/main'/);
  assert.match(privateJob, /repository: Clockoli\/tests-private/);
  assert.match(privateJob, /token: \$\{\{ secrets\.PRIVATE_TESTS_READ_TOKEN \}\}/);
  assert.match(privateJob, /persist-credentials: false/);
  assert.match(privateJob, /npm run test:private/);
  assert.match(privateJob, /RUNNER_TEMP\/private-regressions\.log/);
  assert.doesNotMatch(privateJob, /repository_dispatch|PUBLIC_STATUS_TOKEN|upload-artifact/);
});

test('real releases require the latest trusted main CI private job on the exact tagged commit', () => {
  const release = read('.github/workflows/release.yml');
  assert.match(release, /private-regressions/);
  assert.match(release, /actions: read/);
  assert.match(release, /actions\/workflows\/ci\.yml\/runs\?event=push&branch=main&head_sha=\$\{SHA\}/);
  assert.match(release, /\.head_sha == \$sha and \.event == "push" and \.head_branch == "main"/);
  assert.match(release, /actions\/runs\/\$\{RUN_ID\}\/jobs\?filter=latest/);
  assert.match(release, /\.name == "private-regressions"/);
  assert.match(release, /sort_by\(\.id\) \| last/);
  assert.match(release, /\.conclusion == "success"/);
  assert.doesNotMatch(release, /check-runs|statuses\?per_page|PRIVATE_TESTS_STATUS_ACTOR|PRIVATE_TESTS_APP_ID/);
});
