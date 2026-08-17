import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';

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
  // `dist/docs/openapi.json` is where the build copies the generated spec;
  // fall back to `docs/openapi.json` so unit tests (cwd = backend/) can read
  // it without a preceding build.
  const candidates = [
    resolve(process.cwd(), 'dist', 'docs', 'openapi.json'),
    resolve(process.cwd(), 'docs', 'openapi.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }
  return '{"openapi":"3.0.3","info":{"title":"Purchase Approval Flow API","version":"1.0.0"},"paths":{}}';
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
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: swaggerUiHtml(specUrl(event)),
  };
};

/** GET /docs/openapi.json — the full OpenAPI spec as JSON. */
export const handlerSpec = async (): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: readSpec(),
  };
};
