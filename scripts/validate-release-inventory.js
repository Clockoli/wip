#!/usr/bin/env node
import path from 'node:path';
import { releaseInventory, validateReleaseInventory } from './release-inventory.js';
import { parseArgs } from 'node:util';
import { manifestBytes, TARGETS } from './target-manifest.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const { values } = parseArgs({ options: { target: { type: 'string' }, json: { type: 'boolean' } } });
if (values.json && !values.target) values.target = 'chrome';
for (const target of values.target ? [values.target] : TARGETS) {
  const bytes = manifestBytes(root, target);
  const inventory = await releaseInventory(root, JSON.parse(bytes));
  const summary = await validateReleaseInventory(root, inventory, bytes);
  if (values.json) process.stdout.write(`${JSON.stringify(inventory)}\n`);
  else process.stdout.write(`Validated ${target} release inventory: ${summary.files} runtime files, ${summary.bytes} bytes.\n`);
}
