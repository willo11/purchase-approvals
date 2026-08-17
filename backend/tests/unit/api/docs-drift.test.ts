import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Drift guard: `handlerSpec` prefers `dist/docs/openapi.json` over the
 * committed file (see the readSpec note in docs.ts), so a stale dist would
 * silently serve/assert an older spec. This test pins dist to the committed
 * artifact. It skips gracefully when dist is absent (e.g. before a build).
 */
describe('OpenAPI build drift guard', () => {
  const distSpec = resolve(process.cwd(), 'dist', 'docs', 'openapi.json');
  const committedSpec = resolve(process.cwd(), 'docs', 'openapi.json');

  if (!existsSync(distSpec)) {
    it.skip('skipped — dist/docs/openapi.json is not built yet', () => {
      // dist/ is git-ignored; the guard only asserts when a build exists.
    });
  } else {
    it('served dist spec is byte-identical to the committed openapi.json', () => {
      expect(readFileSync(distSpec, 'utf8')).toBe(
        readFileSync(committedSpec, 'utf8')
      );
    });
  }
});