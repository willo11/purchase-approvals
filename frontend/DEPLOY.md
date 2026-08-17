# Frontend — Deployment (micro-frontends, 3 buckets)

This is a manual, step-by-step guide to deploy the three Module Federation apps
(host, requester, approver) to S3 + CloudFront. It is written so you can walk
through and explain each step. The backend deploy (and the AWS account setup) is
covered in the root `README.md` and the deploy gotchas in `DEPLOY-PROBLEMS.md`.

> **Why three buckets?** Each micro-frontend is an independent, static app.
> Giving each its own bucket keeps their deploys, caching and permissions
> separate, and gives each remote a stable, explicit URL — exactly what Module
> Federation needs. (A single bucket with three folders also works; this guide
> uses the three-bucket layout.)

---

## The order, and why

```
1. buckets (config + CORS + public read)  →  ready before anything is uploaded
2. build+upload requester                 →  its URL now exists
3. build+upload approver                  →  its URL now exists
4. build+upload host (needs those URLs)   →  composes the remotes
5. CloudFront for the host                →  the HTTPS entry point
6. APPROVER_BASE_URL loop                 →  approval links point at the frontend
```

The **host build depends on the requester/approver URLs**: webpack bakes those URLs
into the host bundle at build time. So the remotes must be built and uploaded (and
reachable) BEFORE the host. This is the load-bearing ordering.

---

## Prerequisites (done once)

- The backend is deployed (see `README.md`). In this guide the deployed API base URL is
  referred to as `<API_BASE>` (e.g. `https://<api-id>.execute-api.us-east-1.amazonaws.com/dev`).
- AWS CLI configured with your region (`us-east-1` in this example).
- Frontend deps installed (`pnpm -C frontend/<app> install`).

---

## Phase 1 · Create the buckets + enable website hosting

One bucket per app, each with SPA fallback (deep routes like `/requester/:id` must
serve `index.html`):

```bash
aws s3api create-bucket --bucket purchase-approvals-host-dev --region us-east-1
aws s3api create-bucket --bucket purchase-approvals-requester-dev --region us-east-1
aws s3api create-bucket --bucket purchase-approvals-approver-dev --region us-east-1

aws s3 website "s3://purchase-approvals-host-dev" --index-document index.html --error-document index.html
aws s3 website "s3://purchase-approvals-requester-dev" --index-document index.html --error-document index.html
aws s3 website "s3://purchase-approvals-approver-dev" --index-document index.html --error-document index.html
```

> `--error-document index.html` is the SPA fallback: when the browser hits a deep
> route that has no real file (e.g. `/requester/abc`), S3 serves `index.html` and the
> app re-renders. Without it, refreshing a deep link 404s.

---

## Phase 2 · Security config — WHEN the CORS policy + public read happen

> **Do this here, on each bucket, BEFORE you upload.** The browser needs two things
> the moment your objects exist: (a) the files must be **publicly readable**, and
> (b) the requester/approver buckets must send **CORS** headers so the host's origin
> can load the `remoteEntry.js` cross-origin.

### 2a. Allow public access (S3 blocks it by default)

```bash
# repeat for host, requester, and approver:
aws s3api put-public-access-block --bucket purchase-approvals-requester-dev \
  --public-access-block-configuration \
  BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false
```

### 2b. Public-read bucket policy (so the browser can read the objects)

```bash
# repeat for host, requester, and approver:
aws s3api put-bucket-policy --bucket purchase-approvals-requester-dev --policy \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*",\
    "Action":"s3:GetObject","Resource":"arn:aws:s3:::purchase-approvals-requester-dev/*"}]}'
```

### 2c. CORS policy — ON THE REMOTES (requester, approver) AND the host

The **remotes must allow cross-origin GETs** so the host's JavaScript can fetch their
`remoteEntry.js` + lazy chunks. The host bucket should also allow CORS for safety.

```bash
# requester bucket:
aws s3api put-bucket-cors --bucket purchase-approvals-requester-dev --cors-configuration \
  '{"CORSRules":[{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"]}]}'
# same for approver and host buckets
```

> **Why CORS here?** With Module Federation the host page (CloudFront origin) loads
> the remotes' `remoteEntry.js` via `<script>`/dynamic import. Without an
> `Access-Control-Allow-Origin` header on those files, the browser blocks the
> cross-origin fetch and the composed UIs never mount (looks like a blank/stuck
> page). Static site hosting does NOT add CORS headers by itself — you must set the
> bucket CORS policy.

> The backend API does NOT need a CORS policy here: its `cors: true` is already set
> server-side in `serverless.yml` (see `DEPLOY-PROBLEMS.md` #6). These bucket rules
> are only for the S3-hosted frontend assets.

---

## Phase 3 · Build + upload REQUESTER

```bash
export API_BASE="https://<api-id>.execute-api.us-east-1.amazonaws.com/dev"

API_BASE_URL=$API_BASE pnpm -C frontend/requester run build
aws s3 sync frontend/requester/dist s3://purchase-approvals-requester-dev --delete
```

Reachable at: `https://purchase-approvals-requester-dev.s3-website-us-east-1.amazonaws.com`

---

## Phase 4 · Build + upload APPROVER

```bash
API_BASE_URL=$API_BASE pnpm -C frontend/approver run build
aws s3 sync frontend/approver/dist s3://purchase-approvals-approver-dev --delete
```

Reachable at: `https://purchase-approvals-approver-dev.s3-website-us-east-1.amazonaws.com`

---

## Phase 5 · Build + upload HOST (with the remote URLs)

```bash
API_BASE_URL=$API_BASE \
REQUESTER_REMOTE_URL="https://purchase-approvals-requester-dev.s3-website-us-east-1.amazonaws.com/remoteEntry.js" \
APPROVER_REMOTE_URL="https://purchase-approvals-approver-dev.s3-website-us-east-1.amazonaws.com/remoteEntry.js" \
  pnpm -C frontend/host run build
aws s3 sync frontend/host/dist s3://purchase-approvals-host-dev --delete
```

> **Why the remote URLs in the host build?** `frontend/host/webpack.config.js` reads
> these at build time and bakes them into the host bundle. If you omit them (or use
> the localhost defaults), the host will tell the browser to fetch the remotes from
> the viewer's OWN `localhost:3001/3002` — never loads.

---

## Phase 6 · CloudFront (the HTTPS entry point for the HOST)

1. Create a distribution with origin = the **host** bucket's website endpoint (or use
   an OAI with the bucket policy scoped accordingly).
2. Set the **error response** → `index.html` with 404 (SPA deep links; same reason as
   the `--error-document` above, at the CDN edge).
3. Record the distribution domain: `https://<cloudfront-distribution>.cloudfront.net`

Reachable at: `https://<cloudfront-distribution>.cloudfront.net`

---

## Phase 7 · APPROVER_BASE_URL loop (backend)

The approval links in the demo inbox are built with `APPROVER_BASE_URL` (backend
`TokenIssuer`). Point it at the CloudFront URL so the links open the composed
approver UI, then redeploy the backend:

```bash
# backend/.env
APPROVER_BASE_URL=https://<cloudfront-distribution>.cloudfront.net
pnpm -C backend run predeploy
pnpm -C backend exec sls deploy --stage dev --region us-east-1
```

---

## Phase 8 · Validation checklist

```bash
# 1. Health + Swagger on the deployed API
curl https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/health
#    → {"status":"ok"}
#    → Swagger UI at .../dev/docs

# 2. Host loads and is STYLED (composes requester + approver)
#    https://<cloudfront-distribution>.cloudfront.net/requester

# 3. Full flow: register users via the API → create request → /mock-mail →
#    open link → OTP → approve ×3 → COMPLETED

# 4. Download the PDF and confirm it's real binary bytes (binaryMediaTypes)
curl -D - -o evidence.pdf -H "Accept: application/pdf" \
  https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/api/purchase-requests/<id>/evidence.pdf
file evidence.pdf    # → "PDF document", not ASCII text
```

---

## Gotchas (each breaks silently in local but fails in the real deploy)

| Symptom | Cause | Fix |
|---------|-------|-----|
| 403 on the frontend files | S3 public access blocked by default | Phase 2a + 2b (public-access-block + public-read policy) |
| Remotes never load (blank host) | missing CORS on the remote buckets | Phase 2c (CORS policy) |
| Host looks for remotes on localhost | remote URLs not baked at build time | Phase 5 (REMOTE_URL env vars) |
| Refresh on `/requester/:id` 404 | no SPA fallback | Phase 1 `--error-document` + Phase 6 CDN error response |
| CORS from the deployed frontend | API without `cors:true` | already handled server-side (see `DEPLOY-PROBLEMS.md`) |

See the backend-side deploy issues in `DEPLOY-PROBLEMS.md`.
