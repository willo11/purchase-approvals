// Focused-test guard for the frontend packages (fresh-review FIX 1).
//
// Jest 29 removed the `forbidOnly` option (it existed through Jest 27), so a
// committed `.only`/`.fit`/`.fdescribe` would silently narrow the suite. This
// script scans the package's test tree and fails the run when a focused test
// is found. Wired as the `pretest` hook in frontend/{host,requester,approver}
// package.json (the backend has its own copy at backend/scripts/), so every
// jest invocation in every package is guarded.
//
// Unlike the backend script (which walks `tests/` relative to the script),
// this one resolves the root from the PROCESS CWD, because pnpm lifecycle
// hooks run with cwd = the package directory — the same script file serves
// all three packages from frontend/scripts/.
//
// Usage: node scripts/no-focused-tests.mjs [rootDir]
//   rootDir defaults to 'src'; test files match *.test.js / *.test.jsx.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [rootDir = 'src'] = process.argv.slice(2);
const testsRoot = join(process.cwd(), rootDir);

const FOCUSED = /\.only\(|\bfit\(|\bfdescribe\(/;

function isTestFile(file) {
  return file.endsWith('.test.js') || file.endsWith('.test.jsx');
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (isTestFile(full)) {
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
