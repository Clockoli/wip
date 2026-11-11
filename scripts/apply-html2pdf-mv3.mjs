#!/usr/bin/env node
// Apply Clockoli's sole Manifest V3 patch to a rebuilt upstream PDF bundle.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4 || path.resolve(input) === path.resolve(output)) {
  throw new Error('Usage: node scripts/apply-html2pdf-mv3.mjs UPSTREAM_BUNDLE OUTPUT_BUNDLE');
}
const source = readFileSync(input, 'utf8');
const original = 'Function("return this")()';
if (source.split(original).length !== 2) {
  throw new Error('Expected exactly one legacy core-js global fallback');
}
writeFileSync(output, source.replace(original, '{}'), 'utf8');
