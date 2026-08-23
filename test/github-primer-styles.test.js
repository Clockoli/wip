import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const primer = read('src/styles/github-primer.css');
const documentStyles = [
  'src/options/options.css',
  'src/reports/reports.css',
  'src/tasks/tasks.css',
].map(path => [path, read(path)]);
const content = read('src/content/github.js');
const popupShell = read('src/popup/popup.css');
const popupHtml = read('src/popup/popup.html');
const reports = read('src/reports/reports.js');

const lightTokens = {
  '--bgColor-default': '#fff',
  '--bgColor-muted': '#f6f8fa',
  '--bgColor-inset': '#f6f8fa',
  '--fgColor-default': '#1f2328',
  '--fgColor-muted': '#59636e',
  '--fgColor-accent': '#0969da',
  '--fgColor-danger': '#d1242f',
  '--fgColor-open': '#1a7f37',
  '--fgColor-closed': '#d1242f',
  '--fgColor-done': '#8250df',
  '--borderColor-default': '#d1d9e0',
  '--borderColor-muted': '#d1d9e0b3',
  '--button-default-fgColor-rest': '#25292e',
  '--button-primary-bgColor-hover': '#1c8139',
};
const darkTokens = {
  '--bgColor-default': '#0d1117',
  '--bgColor-muted': '#151b23',
  '--bgColor-inset': '#010409',
  '--fgColor-default': '#f0f6fc',
  '--fgColor-muted': '#9198a1',
  '--fgColor-accent': '#4493f8',
  '--fgColor-danger': '#f85149',
  '--borderColor-default': '#3d444d',
  '--borderColor-muted': '#3d444db3',
  '--button-default-bgColor-rest': '#212830',
  '--button-default-bgColor-hover': '#262c36',
};

function assertToken(css, name, value) {
  assert.match(css, new RegExp(`${name.replaceAll('-', '\\-')}\\s*:\\s*${value.replace('#', '\\#')}\\b`));
}

test('shared extension-page theme mirrors GitHub Primer typography and semantic colors', () => {
  assert.match(primer, /--fontStack-sansSerif:\s*"Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"/);
  assert.match(primer, /--fontStack-monospace:\s*ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace/);
  for (const [name, value] of Object.entries(lightTokens)) assertToken(primer, name, value);
  const dark = primer.match(/@media\(prefers-color-scheme:dark\)\{([\s\S]+)\}\s*$/)?.[1] ?? '';
  for (const [name, value] of Object.entries(darkTokens)) assertToken(dark, name, value);
  for (const name of ['blue', 'green', 'purple', 'orange', 'pink', 'teal', 'red', 'yellow', 'coral', 'lime', 'auburn', 'gray']) {
    assert.match(primer, new RegExp(`--data-${name}-color-emphasis:`));
  }
});

test('every standalone extension surface consumes the shared GitHub theme without a legacy palette', () => {
  assert.match(popupShell, /^@import url\("\.\.\/styles\/github-primer\.css"\);/);
  assert.match(popupHtml, /src="\.\.\/content\/github\.js"/);
  for (const [path, css] of documentStyles) {
    assert.match(css, /^@import url\("\.\.\/styles\/github-primer\.css"\);/, path);
    assert.match(css, /body\{[^}]*font:var\(--text-body-shorthand-medium\)/, path);
    for (const legacy of ['#e6edf3', '#8b949e', '#30363d', '#21262d', '#58a6ff', 'rgba(140,149,159']) {
      assert.doesNotMatch(css, new RegExp(legacy.replace(/[()]/g, '\\$&'), 'i'), `${path} retains ${legacy}`);
    }
  }
});

test('GitHub content UI inherits live host tokens and exact font stacks', () => {
  assert.match(content, /font:var\(--text-body-shorthand-medium,400 14px\/1\.5 "Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"\)/);
  assert.match(content, /font:600 2rem\/1\.5 var\(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace\)/);
  assert.match(content, /box-shadow:var\(--shadow-floating-small,/);
  assert.match(content, /var\(--button-danger-bgColor-rest,/);
  assert.doesNotMatch(content, /@media \(prefers-color-scheme:dark\)/);
  assert.doesNotMatch(content, /#e6edf3|#8b949e|#30363d|#21262d|#58a6ff/i);
});

test('report charts keep live GitHub data-token references instead of fixed or generated colors', () => {
  assert.match(reports, /--data-blue-color-emphasis/);
  assert.match(reports, /`var\(\$\{DATA_COLOR_TOKENS\[index % DATA_COLOR_TOKENS\.length\]\}\)`/);
  assert.doesNotMatch(reports, /getComputedStyle\(document\.documentElement\)/);
  assert.doesNotMatch(reports, /hsl\(/);
});

test('Tasks CSS has no provider-status presentation', () => {
  const tasks = read('src/tasks/tasks.css');
  assert.doesNotMatch(tasks, /\.status\.|task-icon\.(?:open|closed|merged|completed|not-planned|unknown)/);
  assert.match(tasks, /\.task-icon\{[^}]*fill:currentColor/);
});


test('button active, selected, and disabled states mirror live GitHub tokens', () => {
  for (const value of [
    '--button-default-bgColor-active:#e6eaef', '--button-default-bgColor-selected:#e6eaef',
    '--button-default-bgColor-disabled:#eff2f5', '--button-default-fgColor-disabled:#818b98',
    '--button-primary-bgColor-active:#197935', '--button-primary-bgColor-disabled:#95d8a6',
    '--button-danger-bgColor-active:#a40e26', '--button-danger-fgColor-disabled:#d1242f80',
    '--button-default-bgColor-active:#2a313c', '--button-default-bgColor-selected:#2a313c',
    '--button-default-fgColor-disabled:#656c76', '--button-primary-bgColor-active:#2e9a40',
    '--button-primary-bgColor-disabled:#105823', '--button-danger-bgColor-active:#da3633',
    '--button-danger-fgColor-disabled:#f8514980',
  ]) assert.ok(primer.includes(value), `missing live state token ${value}`);

  for (const [path, css] of documentStyles) {
    assert.ok(css.includes('active:not(:disabled)'), `${path} lacks GitHub active state`);
    assert.ok(css.includes('bgColor-disabled'), `${path} lacks GitHub disabled state`);
    assert.doesNotMatch(css, /:disabled\{opacity:/, `${path} still approximates disabled colors with opacity`);
  }
  assert.ok(content.includes('var(--button-default-bgColor-selected,#e6eaef)'));
  assert.ok(content.includes('var(--button-primary-bgColor-active,#197935)'));
  assert.ok(content.includes('var(--button-danger-bgColor-disabled,#eff2f5)'));
  assert.doesNotMatch(content, /button:disabled \{ opacity:/);
});


test('standalone typography uses GitHub live body, title, caption, and label metrics', () => {
  for (const expected of [
    '--text-body-shorthand-medium:400 .875rem/1.5',
    '--text-body-shorthand-small:400 .75rem/1.625',
    '--text-caption-shorthand:400 .75rem/1.25',
    '--text-title-shorthand-large:600 2rem/1.5',
    '--text-title-shorthand-medium:600 1.25rem/1.625',
    '--text-title-shorthand-small:600 1rem/1.5',
    '--text-label-shorthand:600 .75rem/1.5',
  ]) assert.ok(primer.includes(expected), `missing live typography metric ${expected}`);

  const options = read('src/options/options.css');
  const reportsCss = read('src/reports/reports.css');
  const tasksCss = read('src/tasks/tasks.css');
  assert.match(options, /body\{[^}]*font:var\(--text-body-shorthand-medium\)/);
  assert.match(options, /h1\{[^}]*font:var\(--text-title-shorthand-large\)/);
  assert.match(content, /\.muted \{[^}]*font:var\(--text-caption-shorthand/);
  assert.match(reportsCss, /h1\{font:var\(--text-title-shorthand-large\)\}h2\{font:var\(--text-title-shorthand-small\)\}/);
  assert.match(tasksCss, /h1\{font:var\(--text-title-shorthand-large\)\}/);
  for (const [path, css] of documentStyles) {
    assert.doesNotMatch(css, /font-size:(?:11|13|15|28|30)px/, `${path} uses a non-Primer typography size`);
    assert.doesNotMatch(css, /letter-spacing:\.04em/, `${path} uses non-GitHub letter spacing`);
  }
  assert.doesNotMatch(content, /letter-spacing:\.04em/);
});


test('Tasks uses neutral type glyphs without provider status presentation', () => {
  const tasks = read('src/tasks/tasks.js');
  assert.match(tasks, /const ISSUE_OPEN_PATH = '[^']+';/);
  assert.match(tasks, /const PULL_OPEN_PATH = '[^']+';/);
  assert.doesNotMatch(tasks, /ISSUE_CLOSED_PATH|ISSUE_NOT_PLANNED_PATH|PULL_CLOSED_PATH|PULL_MERGED_PATH/);
  assert.doesNotMatch(tasks, /task\.status|statusMatches|statusLabel|stateReason/);
});


test('invisible buttons and danger active state use their exact GitHub tokens', () => {
  for (const token of [
    '--button-invisible-bgColor-rest:#fff0', '--button-invisible-bgColor-hover:#818b981a',
    '--button-invisible-bgColor-active:#818b9826', '--button-invisible-bgColor-disabled:#fff0',
    '--button-invisible-fgColor-disabled:#818b98', '--button-danger-fgColor-active:#fff',
    '--button-danger-borderColor-hover:#1f232826', '--button-danger-borderColor-active:#1f232826',
    '--button-invisible-bgColor-rest:#0000', '--button-invisible-bgColor-hover:#656c7633',
    '--button-invisible-bgColor-active:#656c7640', '--button-invisible-fgColor-disabled:#656c76',
    '--button-danger-borderColor-hover:#ffffff26', '--button-danger-borderColor-active:#ffffff26',
  ]) assert.ok(primer.includes(token), `missing live interaction token ${token}`);

  const reportsCss = read('src/reports/reports.css');
  const tasksCss = read('src/tasks/tasks.css');
  for (const [path, css] of [['reports', reportsCss], ['content', content]]) {
    assert.match(css, /button-invisible-bgColor-hover/, `${path} lacks invisible hover state`);
    assert.match(css, /button-invisible-bgColor-active/, `${path} lacks invisible active state`);
    assert.match(css, /button-invisible-bgColor-disabled/, `${path} lacks invisible disabled state`);
  }
  for (const [path, css] of [['tasks', tasksCss], ['content', content]]) {
    assert.match(css, /button-danger-fgColor-active/, `${path} lacks danger active foreground`);
    assert.match(css, /button-danger-borderColor-active/, `${path} lacks danger active border`);
  }
});

test('form controls use exact GitHub rest, hover, active, selected, checked, placeholder, and disabled tokens', () => {
  for (const token of [
    '--control-bgColor-rest:#f6f8fa', '--control-bgColor-hover:#eff2f5',
    '--control-bgColor-active:#e6eaef', '--control-bgColor-disabled:#eff2f5',
    '--control-fgColor-placeholder:#59636e', '--control-fgColor-disabled:#818b98',
    '--control-borderColor-rest:#d1d9e0', '--control-borderColor-disabled:#818b981a',
    '--control-checked-bgColor-rest:#0969da', '--control-checked-bgColor-hover:#0860ca',
    '--control-checked-bgColor-active:#0757ba', '--control-checked-bgColor-disabled:#818b98',
    '--control-bgColor-rest:#212830', '--control-bgColor-hover:#262c36',
    '--control-bgColor-active:#2a313c', '--control-fgColor-placeholder:#9198a1',
    '--control-borderColor-rest:#3d444d', '--control-checked-bgColor-rest:#1f6feb',
    '--control-checked-bgColor-hover:#2a7aef', '--control-checked-bgColor-active:#3685f3',
  ]) assert.ok(primer.includes(token), `missing live control token ${token}`);

  for (const [path, css] of documentStyles) {
    assert.match(css, /control-bgColor-rest/, `${path} lacks control rest state`);
    assert.match(css, /control-bgColor-hover/, `${path} lacks control hover state`);
    assert.match(css, /control-bgColor-active/, `${path} lacks control active state`);
    assert.match(css, /control-bgColor-disabled/, `${path} lacks control disabled state`);
    assert.match(css, /control-fgColor-placeholder/, `${path} lacks placeholder state`);
  }
  assert.match(read('src/reports/reports.css'), /control-checked-bgColor-(?:rest|hover|active|disabled)/);
  assert.match(content, /control-borderColor-rest,#d1d9e0/);
  assert.match(content, /control-fgColor-placeholder,#59636e/);
});

test('report charts rerender when the live light-dark preference changes', () => {
  assert.match(reports, /matchMedia\('\(prefers-color-scheme: dark\)'\)/);
  assert.match(reports, /colorScheme\.addEventListener\('change', \(\) => \{/);
  assert.match(reports, /if \(state\.range && !state\.loading && !\$\('report-content'\)\.hidden\) render\(\);/);
});


test('print forces GitHub exact light data colors even when the live page is dark', () => {
  const css = read('src/reports/reports.css');
  const print = css.slice(css.indexOf('@media print'));
  for (const token of [
    '--data-blue-color-emphasis:#006edb', '--data-green-color-emphasis:#30a147',
    '--data-purple-color-emphasis:#894ceb', '--data-orange-color-emphasis:#eb670f',
    '--data-pink-color-emphasis:#ce2c85', '--data-teal-color-emphasis:#179b9b',
    '--data-red-color-emphasis:#df0c24', '--data-yellow-color-emphasis:#b88700',
    '--data-coral-color-emphasis:#d43511', '--data-lime-color-emphasis:#527a29',
    '--data-auburn-color-emphasis:#9d615c', '--data-gray-color-emphasis:#808fa3',
  ]) assert.ok(print.includes(token), `print lacks exact light token ${token}`);
});


test('every destructive Delete control receives the complete Primer danger variant', () => {
  assert.match(content, /button\('Delete', 'danger-outline entry-delete'/);
  for (const [surface, css] of [['content', content]]) {
    assert.match(css, /\.danger\s*,\s*\.danger-outline\s*\{[^}]*button-danger-borderColor-rest[^}]*button-danger-bgColor-rest[^}]*button-danger-fgColor-rest/, `${surface} Delete lacks danger rest state`);
    assert.match(css, /\.danger:hover\s*,\s*\.danger-outline:hover\s*\{[^}]*button-danger-borderColor-hover[^}]*button-danger-bgColor-hover[^}]*button-danger-fgColor-hover/, `${surface} Delete lacks danger hover state`);
    assert.match(css, /\.danger:active:not\(:disabled\)\s*,\s*\.danger-outline:active:not\(:disabled\)\s*\{[^}]*button-danger-borderColor-active[^}]*button-danger-bgColor-active[^}]*button-danger-fgColor-active/, `${surface} Delete lacks danger active state`);
    assert.match(css, /\.danger:disabled\s*,\s*\.danger-outline:disabled\s*\{[^}]*button-danger-borderColor-rest[^}]*button-danger-bgColor-disabled[^}]*button-danger-fgColor-disabled/, `${surface} Delete lacks danger disabled state`);
  }
});
