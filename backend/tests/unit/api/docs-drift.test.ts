import { handlerSpec } from '../../../src/api/handlers/docs';
// Import the committed spec EXACTLY as `docs.ts` does (source of truth
// `docs/openapi.yaml`; the JSON is a committed, generated artifact). esbuild
// bundles this JSON into the handler, so there is no `dist/docs` copy to drift
// against anymore.
import committedSpec from '../../../docs/openapi.json';

/**
 * Drift guard (import-based): with serverless-esbuild there is no
 * `dist/docs/openapi.json` — the docs handler now IMPORTS
 * `docs/openapi.json` directly and serves its content. So the only drift to
 * guard is "the handler must keep serving exactly the committed artifact",
 * which this pins: the spec `handlerSpec` returns must match the committed,
 * source-of-truth `docs/openapi.json` (same 12 paths, same servers).
 */
describe('OpenAPI served-spec drift guard (import-based)', () => {
  const committed = committedSpec as unknown as {
    openapi: string;
    paths: Record<string, unknown>;
    servers: Array<{ url: string; description?: string }>;
  };

  it('serves the committed openapi.json as-is (same spec, same 12 paths)', async () => {
    const served = await handlerSpec();
    const body = JSON.parse(served.body) as {
      openapi: string;
      paths: Record<string, unknown>;
      servers: Array<{ url: string; description?: string }>;
    };

    expect(served.statusCode).toBe(200);
    expect(body.openapi).toBe(committed.openapi);
    expect(Object.keys(body.paths)).toEqual(Object.keys(committed.paths));
    expect(committed.paths).toEqual(body.paths);
    expect(Object.keys(body.paths)).toHaveLength(12);
  });

  it('serves the committed servers verbatim by default', async () => {
    const served = await handlerSpec();
    const body = JSON.parse(served.body) as {
      servers: Array<{ url: string; description?: string }>;
    };
    expect(body.servers).toEqual(committed.servers);
  });
});
