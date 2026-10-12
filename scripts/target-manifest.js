import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const TARGETS = ['chrome', 'firefox', 'safari'];

export function targetManifest(source, target) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown extension target: ${target}`);
  const manifest = structuredClone(source);
  if (target === 'chrome') return manifest;
  manifest.permissions = manifest.permissions.filter(permission => permission !== 'favicon');
  manifest.web_accessible_resources = manifest.web_accessible_resources
    .map(entry => ({ ...entry, resources: entry.resources.filter(resource => resource !== '_favicon/*') }))
    .filter(entry => entry.resources.length);
  delete manifest.minimum_chrome_version;
  if (target === 'firefox') {
    manifest.background = { scripts: [source.background.service_worker], type: 'module' };
    manifest.browser_specific_settings = { gecko: {
      id: 'clockoli@clockoli.com',
      strict_min_version: '140.0',
      data_collection_permissions: {
        required: ['authenticationInfo', 'personallyIdentifyingInfo', 'browsingActivity', 'websiteContent'],
      },
    } };
  } else {
    manifest.browser_specific_settings = { safari: { strict_min_version: '18.0' } };
  }
  return manifest;
}

export function manifestBytes(root, target) {
  const source = readFileSync(path.join(root, 'manifest.json'));
  const generated = targetManifest(JSON.parse(source), target);
  return target === 'chrome' ? source : Buffer.from(`${JSON.stringify(generated, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(manifestBytes(path.resolve(import.meta.dirname, '..'), process.argv[2]));
}
