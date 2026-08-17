// Post-build guard: the HOST bundle must never contain a live `process.env`
// reference. The browser has no `process` object — a leftover expression like
// `process.env.API_BASE_URL` crashes the whole app with `process is not
// defined` (fresh-review FIX 1). webpack's DefinePlugin replaces the expression
// with its literal at build time; this script FAILS the build if any `process.env`
// literal survives in the emitted chunks (ours or a future dependency's).
//
// Usage (pnpm lifecycle hook, cwd = package dir):
//   node ../scripts/guard-no-process-env.mjs [distDir]
//   - resolves `<distDir>` relative to process.cwd() (default 'dist')
//   - exits 0 when no chunk contains `process.env`, 1 otherwise
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const distDir = resolve(process.cwd(), process.argv[2] ?? 'dist');

if (!existsSync(distDir)) {
  console.error(`[guard-no-process-env] dist directory not found: ${distDir}`);
  process.exit(1);
}

const chunks = readdirSync(distDir).filter((f) => f.endsWith('.js'));
const offenders = [];

for (const chunk of chunks) {
  const source = readFileSync(join(distDir, chunk), 'utf8');
  if (source.includes('process.env')) {
    offenders.push(chunk);
  }
}

if (offenders.length > 0) {
  console.error(
    '[guard-no-process-env] FAILED: the host bundle contains live `process.env` references:'
  );
  for (const chunk of offenders) {
    console.error(`  - ${chunk}`);
  }
  console.error(
    'A browser has no `process` object — the emitted host app would crash with ' +
      '"process is not defined". Fix the DefinePlugin mapping in webpack.config.js.'
  );
  process.exit(1);
}

console.log(`[guard-no-process-env] OK: ${chunks.length} chunk(s), no \`process.env\` literal.`);