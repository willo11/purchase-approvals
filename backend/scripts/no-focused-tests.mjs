// Focused-test guard (fresh-review FIX 4).
//
// Jest 29 removed the `forbidOnly` option (it existed through Jest 27), so a
// committed `.only`/`.fit`/`.fdescribe` would silently narrow the suite. This
// script scans the test tree and fails the run when a focused test is found.
// Wired as the `pretest*` hooks in package.json, so every jest invocation is
// guarded.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const testsRoot = new URL('../tests/', import.meta.url).pathname;

const FOCUSED = /\.only\(|\bfit\(|\bfdescribe\(/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (full.endsWith('.ts')) {
      yield full;
    }
  }
}

const hits = [];
for (const file of walk(testsRoot)) {
  const source = readFileSync(file, 'utf8');
  if (FOCUSED.test(source)) hits.push(file);
}

if (hits.length > 0) {
  console.error('Focused tests found (`.only`/`fit`/`fdescribe`):');
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log('No focused tests found.');
