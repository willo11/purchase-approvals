#!/usr/bin/env node
/**
 * Copies the generated OpenAPI spec into `dist/docs/openapi.json` so the `docs`
 * Lambda can serve it at runtime without a runtime YAML/JSON dependency.
 *
 * The source of truth is `docs/openapi.yaml`; `docs/openapi.json` is committed
 * as a generated artifact (see the `_generatedFrom` field). This build step just
 * makes that JSON available next to the compiled handlers in `dist/`.
 *
 * Uses `node:fs` directly — no new npm dependency.
 */
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const src = join(root, 'docs', 'openapi.json');
const destDir = join(root, 'dist', 'docs');
const dest = join(destDir, 'openapi.json');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-openapi] ${src} -> ${dest}`);
