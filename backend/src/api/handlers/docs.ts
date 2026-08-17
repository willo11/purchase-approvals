import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
// The OpenAPI spec is a committed, generated artifact (source of truth
// `docs/openapi.yaml`). Importing the JSON lets serverless-esbuild BUNDLE it
// into the docs handler — there is no `dist/docs` copy anymore (esbuild ships
// only the bundle), so a static `import` keeps the spec available at runtime
// without extra package config or a fs read.
import openapiJson from '../../../docs/openapi.json';
import { corsHeaders } from '../cors';

/**
 * Serves the interactive Swagger UI from the serverless API itself.
 *
 * Two routes:
 * - `GET /docs` → Swagger UI HTML shell (assets loaded from the unpkg CDN,
 *   so we ship NO bundled JS/CSS and add no npm dependency). The UI is wired
 *   to load the OpenAPI spec from `/{stage}/docs/openapi.json` so it resolves
 *   under the same API Gateway stage when served (offline `/dev` or deployed).
 * - `GET /docs/openapi.json` → the OpenAPI spec as JSON.
 *
 * The spec is a committed, generated artifact (`docs/openapi.json`, source of
 * truth `docs/openapi.yaml`); the build copies it to `dist/docs/openapi.json`.
 * At runtime the handler reads it relative to the working directory, falling
 * back to `docs/openapi.json` so unit tests run straight from `src`.
 */

/** Swagger UI CDN asset URLs (swagger-ui-dist@5 on unpkg). */
const SWAGGER_UI_CSS =
  'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css';
const SWAGGER_UI_BUNDLE_JS =
  'https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js';
const SWAGGER_UI_STANDALONE_PRESET_JS =
  'https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js';

function readSpec(): string {
  // esbuild bundles the imported JSON into this handler (see the import above),
  // so there is no `dist/docs` copy at runtime — we always serve the committed,
  // bundled spec verbatim. JSON.stringify of the freshly imported object
  // reproduces the same spec data (paths, servers); indentation is compact.
  return JSON.stringify(openapiJson);
}

/**
 * Resolves the spec URL under the current API Gateway stage so the Swagger UI
 * loads the right endpoint whether served by serverless-offline (`/dev/docs`)
 * or a deployed API Gateway (`/dev/docs` by default). requestContext.stage is
 * populated by both runtimes.
 */
function specUrl(event: APIGatewayProxyEvent): string {
  const stage = event.requestContext?.stage ?? 'dev';
  return `/${stage}/docs/openapi.json`;
}

function swaggerUiHtml(specBaseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Purchase Approval Flow API — Swagger UI</title>
  <link rel="stylesheet" href="${SWAGGER_UI_CSS}" />
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { padding: 10px 0; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI_BUNDLE_JS}"></script>
  <script src="${SWAGGER_UI_STANDALONE_PRESET_JS}"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: '${specBaseUrl}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: 'StandaloneLayout'
      });
    };
  </script>
</body>
</html>`;
}

/** GET /docs — Swagger UI HTML shell. */
export const handlerDocs = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    body: swaggerUiHtml(specUrl(event)),
  };
};

/**
 * Derives the API base URL at request time so Swagger UI's "Try it out" targets
 * the environment that actually served the request — on the DEPLOYED API the
 * committed spec's `servers[0]` points at localhost, which would send "Try it
 * out" calls at the developer's machine instead of API Gateway.
 *
 * Sources: the `Host` header (real in both serverless-offline and API Gateway)
 * plus `requestContext.stage` (real in both). The scheme comes from
 * `X-Forwarded-Proto` when present (API Gateway behind HTTPS), otherwise a
 * loopback host is assumed http and anything else https. NOTE: we deliberately
 * do NOT use `requestContext.domainName`/`requestContext.protocol` for this —
 * serverless-offline fills them with `offlineContext_domainName` and the HTTP
 * version string (`HTTP/1.1`), neither of which is a usable host/scheme.
 * Returns null when the context lacks the pieces, so callers fall back to the
 * committed `servers`.
 */
function deriveApiBase(event: APIGatewayProxyEvent): string | null {
  const headers = event.headers ?? {};
  const host = headers['Host'] ?? headers['host'] ?? headers['HOST'];
  const stage = event.requestContext?.stage;
  if (!host || !stage || host === 'offlineContext_domainName') {
    return null;
  }
  const forwardedProto =
    headers['X-Forwarded-Proto'] ?? headers['x-forwarded-proto'];
  const loopback = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const scheme =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : loopback
        ? 'http'
        : 'https';
  return `${scheme}://${host}/${stage}`;
}

/** GET /docs/openapi.json — the full OpenAPI spec as JSON. */
export const handlerSpec = async (
  event?: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const raw = readSpec();
  const base = event === undefined ? null : deriveApiBase(event);
  if (base === null) {
    // No derivable context → serve the committed artifact verbatim.
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: raw,
    };
  }
  const spec = JSON.parse(raw) as {
    servers?: Array<{ url: string; description?: string }>;
  };
  if (Array.isArray(spec.servers) && spec.servers.length > 0) {
    spec.servers[0] = {
      url: base,
      description: 'This API (derived at request time)',
    };
  }
  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  };
};
