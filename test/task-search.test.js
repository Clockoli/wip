import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ui/task-search.js', import.meta.url), 'utf8');
const context = vm.createContext({});
new vm.Script(source).runInContext(context);
const { mount } = context.ClockoliTaskSearch;

function input() {
  const listeners = new Map();
  return {
    value: '', focused: false,
    addEventListener(type, callback) { listeners.set(type, callback); },
    dispatch(type) { listeners.get(type)?.(); },
    focus() { this.focused = true; },
  };
}

test('task search matches title, canonical URL and GitHub issue coordinates without changing order', () => {
  const field = input();
  const search = mount(field);
  const tasks = [
    { title: 'Fix ranking', taskUrl: 'https://github.com/acme/app/issues/42', issue: { owner: 'acme', repo: 'app', number: 42, type: 'issue' } },
    { title: 'Write docs', taskUrl: 'https://example.com/docs' },
  ];
  for (const term of [' FIX ', '#42', 'ACME/APP', 'issues/42']) {
    field.value = term;
    assert.deepEqual([...search.matches(tasks)], [tasks[0]]);
  }
  field.value = '';
  assert.deepEqual([...search.matches(tasks)], tasks);
});

test('one search instance supports entry projections, eligibility and a bounded suggestion list', () => {
  const field = input();
  const entries = [
    { taskTitle: 'Review patch', issue: { url: 'https://github.com/acme/app/pull/5' }, eligible: false },
    { taskTitle: 'Review design', taskUrl: 'https://example.com/design', eligible: true },
    { taskTitle: 'Other', taskUrl: 'https://example.com/other', eligible: true },
  ];
  let changes = 0;
  const search = mount(field, { onInput: () => { changes++; }, textOf: entry => `${entry.taskTitle} ${entry.taskUrl || entry.issue?.url}` });
  field.value = ' REVIEW ';
  field.dispatch('input');
  assert.equal(changes, 1);
  assert.deepEqual([...search.matches(entries, entry => entry.eligible, 1)], [entries[1]]);
  field.value = 'pull/5';
  assert.deepEqual([...search.matches(entries)], [entries[0]]);
  search.clear();
  assert.equal(field.value, '');
  assert.equal(field.focused, true);
  assert.equal(changes, 2);
});

test('record search matches visible title and URL independently without hidden issue metadata', () => {
  const field = input();
  const entry = { taskTitle: 'Fix renderer', title: 'Outdated title', url: 'https://github.com/acme/app/pull/42',
    issue: { type: 'pull_request', owner: 'acme', repo: 'app', number: 42 } };
  const search = mount(field, { textOf: item => [item.taskTitle, item.taskUrl ?? item.issue?.url ?? item.url] });
  for (const term of ['fix renderer', 'pull/42']) {
    field.value = term;
    assert.deepEqual([...search.matches([entry])], [entry]);
  }
  for (const term of ['outdated title', 'pull_request', 'fix renderer,https://']) {
    field.value = term;
    assert.deepEqual([...search.matches([entry])], []);
  }
});

test('task search includes a fallback URL when taskUrl is absent', () => {
  const field = input();
  const search = mount(field);
  const entry = { title: 'Current title', url: 'https://example.com/unique-record' };
  field.value = 'unique-record';
  assert.deepEqual([...search.matches([entry])], [entry]);
});

test('all task and issue search surfaces mount the shared component', () => {
  for (const file of ['tasks/tasks.js', 'options/options.js', 'ui/add-time.js', 'content/github.js']) {
    const code = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.match(code, /ClockoliTaskSearch\.mount\(/, file);
  }
});
