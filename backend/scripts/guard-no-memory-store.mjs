// Deploy guard: `EVIDENCE_STORE=memory` must NEVER reach deployed Lambdas.
//
// serverless-dotenv-plugin / useDotenv inject `backend/.env` into the deployed
// function environment. If the file still carries EVIDENCE_STORE=memory (the
// LOCAL demo default), production would silently use the process-local
// in-memory evidence store: PDFs are lost on every cold start and Download PDF
// returns 404 while the request shows COMPLETED. Docs-only mitigation is not a
// guard — this script FAILS the deploy with a clear message instead.
//
// It checks BOTH the .env file (what the dotenv plugin will inject) and the
// current shell environment (e.g. CI exporting it accidentally). Runs
// automatically as the `predeploy` lifecycle hook of `pnpm -C backend run
// deploy`; also runnable standalone.
//
// Usage:
//   node scripts/guard-no-memory-store.mjs [envFile]   # default backend/.env
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', process.argv[2] ?? '.env');

/** Minimal .env parser matching how the dotenv plugins read the file. */
function envVarsFromFile(file) {
  const vars = {};
  if (!existsSync(file)) return vars;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[trimmed.slice(0, eq).trim()] = value;
  }
  return vars;
}

const isMemory = (value) =>
  value !== undefined && value !== '' && value.trim().toLowerCase() === 'memory';

const fromFile = envVarsFromFile(envFile);
const fromProcess = process.env.EVIDENCE_STORE;

const sources = [];
if (isMemory(fromFile.EVIDENCE_STORE)) sources.push(envFile);
if (isMemory(fromProcess)) sources.push('the shell environment');

if (sources.length > 0) {
  console.error(`✗ DEPLOY GUARD: EVIDENCE_STORE=memory is set (${sources.join(' and ')}).`);
  console.error(
    '  Deployed Lambdas would use the process-local in-memory evidence store —' +
      ' PDFs are lost on every cold start and Download PDF returns 404.'
  );
  console.error(
    '  Remove/unset EVIDENCE_STORE in backend/.env before deploying (the S3 adapter is the deploy default).'
  );
  process.exit(1);
}

console.log('✓ DEPLOY GUARD: EVIDENCE_STORE is not "memory" — deploy uses the S3 evidence store.');