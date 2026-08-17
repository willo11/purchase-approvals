# Deployment Problems

A running log of deploy blockers hit on this repo and how each was fixed. Use it
to avoid re-diagnosing the same failure. All SQL-backed diagnostics assume the
backend deploy flow described in [`README.md`](./README.md#deployment).

| # | Symptom / error | Root cause | Fix |
|---|-----------------|------------|-----|
| 1 | `serverless deploy --` **not found** (`command "deploy --" not found`) | Running `pnpm run deploy -- --stage dev` leaks a literal `--` into `serverless` because pnpm passes everything after the script name straight through. | Run the CLI directly with `pnpm exec` (NOT `pnpm run ... -- --...`): `pnpm -C backend exec sls deploy --stage dev --region us-east-1`. |
| 2 | `The security token included in the request is invalid` | Dummy local AWS credentials (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) in `backend/.env` shadow the real AWS profile during deploy. | Remove the dummy credential lines from `backend/.env` so the real profile is used. |
| 3 | `A sibling ({id}) ... only one is allowed` | API Gateway allows only ONE variable path segment per resource level. The recover endpoint used `{requestId}` next to `{id}` under `api/purchase-requests/`, producing two sibling variable segments at the same level. | Renamed the recover path param to `{id}` (`api/purchase-requests/{id}/approvers/{email}/recover`) and updated the handler + frontend API call. |
| 4 | `Lambda ... reserved keys ...: AWS_REGION` | `serverless-dotenv-plugin` injected `AWS_REGION` from `backend/.env` into the function environment — a reserved Lambda key (Lambda refuses to override it). | Removed `AWS_REGION` from `backend/.env` (and `.env.example`); let the runtime / provider region govern. |
| 5 | `Unzipped size must be smaller than 262144000 bytes` (CREATE_FAILED on a Lambda) | With pnpm, Serverless was packaging the ENTIRE `.pnpm` virtual store (all deps incl. dev): **274MB zip / 840MB unzipped / 133,315 files**. | Bundle each handler with `serverless-esbuild` (tree-shakes only the imported runtime deps) → 1.4MB zip / ~4MB unzipped / 8 files, no `node_modules`. |
| 6 | *(reserved)* | — | — |
| 7 | Browser blocks cross-origin requests: the OPTIONS preflight returns the CORS headers but the actual GET/POST method responses lack `Access-Control-Allow-Origin` | `cors: true` on an http event only affects the API Gateway-generated OPTIONS preflight. With Lambda proxy integration the real method responses are built by the handler, and API Gateway does NOT add CORS headers to them — serverless-offline injected CORS locally (so it "just worked"), real API Gateway does not. | Add a shared `corsHeaders` helper (`backend/src/api/cors.ts`) and merge `{ ...corsHeaders, ...headers }` into EVERY Lambda response (health, userRegistry, purchaseRequest, otp, signature, evidence, mockMail, docs). Keep `cors: true` for the preflight. |

> **Why esbuild fixed #5:** handlers previously pointed at compiled `dist/...` and
> Serverless shipped the whole dependency graph. esbuild resolves each handler
> straight from `src/` and bundles ONLY the code it imports, so the zip is a
> handful of tiny JS bundles with no `node_modules`. See
> `backend/serverless.yml` (`custom.esbuild`, `package.individually: false`) and
> the docs handler's JSON `import`.
