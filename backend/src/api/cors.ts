/**
 * CORS headers shared by every Lambda (proxy) response.
 *
 * `serverless.yml` sets `cors: true` on each http event, which makes API
 * Gateway answer the OPTIONS preflight with the right CORS headers. But with
 * Lambda proxy integration the ACTUAL method responses (GET/POST/…) are built
 * by the handler itself, and API Gateway does NOT add CORS headers to them —
 * serverless-offline injected CORS locally, real API Gateway does not. Without
 * `Access-Control-Allow-Origin` on the real response, the browser blocks the
 * cross-origin call even though the preflight passes.
 *
 * Merge these into every handler's `headers` via `{ ...corsHeaders,
 * ...existingHeaders }` so existing headers (Content-Type, Content-Disposition)
 * are preserved.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
  'Access-Control-Allow-Headers':
    'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
};
