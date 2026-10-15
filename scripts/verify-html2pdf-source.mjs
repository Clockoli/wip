#!/usr/bin/env node
// Verify the exact, intentionally modified html2pdf.js v0.14.0 distribution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendoredPath = path.join(root, 'src/vendor/html2pdf.bundle.min.js');
const UPSTREAM_SHA256 = '9563c45f032179c73454293a649929e60fc24c05a326e8ab2811cfa8f25c3607';
const VENDORED_SHA256 = '2be8dd6f51226c102898621d20c355cf4da81d596846622ddb13b5b55709496e';
const OLD_FALLBACK = 'Function("return this")()';
const NEW_FALLBACK = '{}';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

const vendored = readFileSync(vendoredPath);
assert.equal(hash(vendored), VENDORED_SHA256, 'Vendored PDF bundle changed unexpectedly');
assert.equal(vendored.toString().includes(OLD_FALLBACK), false, 'Unsafe global fallback was reintroduced');

const upstreamPath = process.argv[2];
if (process.argv.length > 3 || upstreamPath === '--help') {
  console.log('Usage: node scripts/verify-html2pdf-source.mjs [PATH_TO_UPSTREAM_V0.14.0_BUNDLE]');
  process.exit(upstreamPath === '--help' ? 0 : 1);
}
if (upstreamPath) {
  const upstream = readFileSync(upstreamPath);
  assert.equal(hash(upstream), UPSTREAM_SHA256, 'Not the pinned official html2pdf.js v0.14.0 bundle');
  const source = upstream.toString('utf8');
  assert.equal(source.split(OLD_FALLBACK).length, 2, 'Expected exactly one legacy core-js fallback');
  assert.deepEqual(Buffer.from(source.replace(OLD_FALLBACK, NEW_FALLBACK)), vendored,
    'Clockoli bundle must differ from upstream by exactly the documented replacement');
}
console.log(upstreamPath ? 'Verified upstream PDF bundle and exact MV3 patch.' : 'Verified vendored PDF bundle checksum.');
