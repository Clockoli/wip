#!/usr/bin/env node
import path from 'node:path';
import { releaseInventory, validateReleaseInventory } from './release-inventory.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const inventory = await releaseInventory(root);
const summary = await validateReleaseInventory(root, inventory);
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(inventory)}\n`);
else process.stdout.write(`Validated release inventory: ${summary.files} runtime files, ${summary.bytes} bytes.\n`);
