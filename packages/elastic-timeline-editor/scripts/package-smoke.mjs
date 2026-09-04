import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const project = resolve(import.meta.dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'elastic-timeline-consumer-'))

try {
  const packResult = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts'], {
    cwd: project,
    encoding: 'utf8',
  }))
  const tarball = resolve(project, packResult[0].filename)

  writeFileSync(join(temp, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    scripts: { build: 'vite build' },
    dependencies: {
      'elastic-timeline-editor': `file:${tarball}`,
      vite: '^7.1.3',
      typescript: '^5.9.0',
    },
  }, null, 2))
  mkdirSync(join(temp, 'src'))
  writeFileSync(join(temp, 'index.html'), '<div id="app"></div><script type="module" src="/src/main.ts"></script>')
  writeFileSync(join(temp, 'src/main.ts'), `
import { createElasticTimeline, type TimelineItem } from 'elastic-timeline-editor'
import 'elastic-timeline-editor/style.css'

const now = Date.now()
const items: TimelineItem[] = [{
  id: 'one', title: 'One', startedAt: now - 120_000, endedAt: now - 60_000,
}]
const timeline = createElasticTimeline(document.querySelector('#app')!, { items, now })
timeline.update({ now })
timeline.getView()
timeline.destroy()
`)

  execFileSync('npm', ['install', '--ignore-scripts'], { cwd: temp, stdio: 'inherit' })
  execFileSync('npx', ['tsc', '--noEmit', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ES2022', '--lib', 'ES2022,DOM', 'src/main.ts'], {
    cwd: temp,
    stdio: 'inherit',
  })
  execFileSync('npm', ['run', 'build'], { cwd: temp, stdio: 'inherit' })

  const built = readFileSync(join(temp, 'dist/index.html'), 'utf8')
  assert.match(built, /<script type="module"/)
  const module = await import(pathToFileURL(resolve(temp, 'node_modules/elastic-timeline-editor/dist/elastic-timeline-editor.js')))
  assert.equal(typeof module.createElasticTimeline, 'function')
  console.log('package consumer smoke passed')

  rmSync(tarball)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
