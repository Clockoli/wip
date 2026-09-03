import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const timelineProject = resolve(import.meta.dirname, '../../timeline')
const packageJson = resolve(timelineProject, 'package.json')

if (!existsSync(packageJson)) {
  throw new Error(`Elastic Timeline test project is required at ${timelineProject}`)
}

console.log(`Running the complete Elastic Timeline suite from ${timelineProject}`)
execFileSync('npm', ['run', 'test:all'], {
  cwd: timelineProject,
  stdio: 'inherit',
})
console.log('Building the non-module IIFE artifact for the Clockoli content script')
execFileSync('npm', ['run', 'build:content-script'], {
  cwd: timelineProject,
  stdio: 'inherit',
})
