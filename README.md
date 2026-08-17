# Purchase Approval Flow

**MVP: serverless purchase-approval workflow with CONSENT SIGNATURE and immutable evidence.** Flow: create request → unique link per approver → OTP → approve/reject with CAS → PDF evidence on completion. Architecture: Lambda + API Gateway + DynamoDB single-table + S3, clean architecture, micro-frontends with Module Federation, unit + integration + concurrency tests, CI.

It is **not** a payment system and **not** PKI/cryptographic signing — the "signature" is registered consent evidence: registered snapshot name + timestamp after OTP validation (the assignment allows "name + date or a simulated signature image").

## Quick path (5 minutes to a working demo)

```bash
# 1. Install (once)
pnpm install && pnpm -C backend install && pnpm -C frontend/host install && \
  pnpm -C frontend/requester install && pnpm -C frontend/approver install

# 2. Local env — the template already sets the demo switches:
#    EVIDENCE_STORE=memory (Download PDF works locally without AWS creds) and
#    APPROVER_BASE_URL=http://localhost:3000 (mailed links open the host).
#    Fresh clone: cp backend/.env.example backend/.env
#    EXISTING backend/.env (e.g. created before this PR): do NOT overwrite it —
#    copy (cp) clobbers any custom values. Add the two new keys manually:
#      EVIDENCE_STORE=memory
#      APPROVER_BASE_URL=http://localhost:3000
cp backend/.env.example backend/.env   # or extend your existing backend/.env

# 3. Build the backend (dist/ is gitignored; serverless.yml loads handlers
#    from dist/, so a fresh clone has nothing to serve until this runs)
pnpm -C backend run build

# 4. One-shot local setup: start dynamodb-local, create the table and seed the
#    demo cast (db:up && db:create-table && db:seed in one command)
pnpm run demo:setup

# 5. Start everything (backend on :4000, frontends on :3000/:3001/:3002)
pnpm run dev

# 6. (Optional, separate terminal) Seed READY-MADE demo states. The backend
#    must be running (step 5) — the script drives the real API to build 4 demo
#    requests (rejected / completed / pending with regenerated OTP / fresh).
pnpm -C backend run db:seed-scenarios
```

Open **http://localhost:3000** → the demo hub: **Requester panel** (`/requester`)
to create a request, or **Approver console** (`/demo`) to see every request and
jump straight into each approver's OTP flow. The demo inbox is
**http://localhost:4000/dev/mock-mail** (backend JSON, filterable per recipient
with `?to=<email>`). Complete all 3 approvals → **COMPLETED** + **Download PDF**
(works locally thanks to the in-memory evidence store — see
[Local run instructions](#local-run-instructions)).

## Demo scenarios (one command)

After the stack is up, `pnpm -C backend run db:seed-scenarios` (run from a
second terminal while `pnpm run dev` is running) drives the **real backend
API** to build four ready-made states to explore:

| Seeded request | State | How to explore |
|----------------|-------|----------------|
| **Rejected demo** | `REJECTED` | open any of its approval links → terminal screen (nothing to act on) |
| **Completed demo** | `COMPLETED` | detail shows COMPLETED + **Download PDF** (real PDF with `EVIDENCE_STORE=memory`) |
| **Pending demo (OTP regenerated)** | `PENDING` | Ana has 2 OTP mails — only the NEWEST code validates; the expired link offers "Generate new OTP" |
| **Pending demo (fresh)** | `PENDING` | drive the full happy path yourself: OTP → approve ×3 → COMPLETED + PDF |

Every run creates a **new** set of requests — there is no cleanup, the demo
grows (existing data is untouched).

## System description

- **Consent signature**: when an approver approves, the system records their **registered snapshot name + timestamp** after OTP validation. This is registered consent evidence — it is not a cryptographic signature (no PKI, no private keys).
- **Immutable evidence**: on the 3rd approval (CAS winner), the backend generates a **PDF** (`pdf-lib`, standard Helvetica font) with the request data, the requester's snapshot name, and exactly 3 signature rows, and stores it in S3 under a deterministic key.
- **Concurrency-safe**: every global transition (`PENDING → COMPLETED | REJECTED`) is an atomic conditional write (compare-and-swap) on the request item — exactly one writer wins, approve-vs-reject can never race into an inconsistent state.
- **Demo identity**: email-only, no passwords (see [Auth disclaimer](#auth-disclaimer) — REQUIRED reading).

## Architecture

### Serverless backend (clean architecture)

```
            ┌─────────────────────────────────────────────────────┐
            │              API Gateway (REST, /dev)               │
            └──────────────────────────┬──────────────────────────┘
                                       │ JSON / application/pdf
            ┌──────────────────────────▼──────────────────────────┐
            │            Lambda handlers (one per endpoint)       │
            │  api/handlers/ — userRegistry, purchaseRequest,     │
            │  otp, signature, evidence, mockMail                 │
            └──────────────────────────┬──────────────────────────┘
                                       │ use cases (ports injected)
            ┌──────────────────────────▼──────────────────────────┐
            │      application/ — RegisterUser, CreateRequest,    │
            │      IssueOtp, ValidateOtp, ApproveRequest, ...     │
            └──────────────────────────┬──────────────────────────┘
                                       │ depends on PORTS (interfaces)
            ┌──────────────────────────▼──────────────────────────┐
            │  infrastructure/ — DynamoDB adapters, MockMailRepo, │
            │  TokenIssuer, PdfGenerator, S3EvidenceStore         │
            └─────────────────────┬──────────────┬────────────────┘
                                  │              │
                 ┌────────────────▼───┐    ┌─────▼─────────────────┐
                 │ DynamoDB single-   │    │ S3 evidence bucket    │
                 │ table (PK/SK, GSI1 │    │ reqs/<id>/evidence.pdf │
                 │ TTL on otpExpiresAt)│    └───────────────────────┘
                 └────────────────────┘
```

- **Layers**: `domain/` (entities + value objects, zero framework deps) → `application/` (use cases + ports) → `infrastructure/` (adapters) → `api/handlers/` (thin error→HTTP mappers). The domain has no idea AWS exists.
- **Single table**: `USER#<email>`, `REQ#<id>`, `REQ#<id>/APPR#<email>`, `OTP#<reqId>#<email>` (TTL), `MAIL#<uuid>`. One table, every access pattern is one read.
- **The request item is the concurrency lock**: completion is `attribute_not_exists(completedAt) AND #status = :pending`; reject is `status = PENDING AND attribute_not_exists(rejectedAt)` — `completed XOR rejected` by construction.
- **Mock mail as outbox**: every "sent" mail is a row in the table; `GET /mock-mail` is the demo inbox. Swapping to SES later is one adapter behind `MailPort`.

### Micro-frontends (Module Federation)

```
            ┌──────────────────────── HOST :3000 ───────────────────────┐
            │  Shell + routing chassis (React.lazy / Suspense)         │
            │   /            demo hub (entry: two cards + tips)        │
            │   /demo        approver console (request cards →         │
            │                approver cards → real /approve link)      │
            │   /requester*  ──lazy loads──►  requester remote :3001   │
            │   /approve*    ──lazy loads──►  approver  remote :3002   │
            └───────────────────────────────────────────────────────────┘
                                   │
              remotes never talk to each other — the REST API is the only contract
```

- **requester** (`:3001`): list requests, create form (requester + 3 distinct approvers), detail + per-approver status table, **Download PDF** when COMPLETED.
- **approver** (`:3002`): the `/approve` gate — link resolution, OTP entry/regenerate, approve-without-name, reject-with-confirm, terminal screens. State machine driven by the backend's error→HTTP codes.
- Shared `react`/`react-dom`/`react-router-dom` as singletons; the CSS ships through the exposed module graph (App.jsx imports `globals.css`).
- Each remote is independently built, tested (≥60% coverage) and deployable.

## End-to-end demo walkthrough

> Everything runs locally with Docker + `serverless-offline` — no AWS account needed.

| Step | Action | Where | Result |
|------|--------|-------|--------|
| 1 | Register 4 employees (1 requester + 3 approvers) | **Seed or curl first** — the create form only LISTS registered users, it has no inline registration. Fastest: `pnpm -C backend run db:seed` (idempotent: Ruth requester + Ana/Sven/Luca approvers). Or use the PR #1 curls in `MANUAL-TESTING.md` (4× `POST /api/users`) | Users in registry |
| 2 | Create a purchase request (title, amount, requester + 3 distinct approvers) | `http://localhost:3000/requester/new` | Request `PENDING`, 1 unique approval link per approver |
| 3 | Open the demo inbox (backend JSON, not a frontend page) | `http://localhost:4000/dev/mock-mail` (per recipient: `.../mock-mail?to=ana@example.com`) | Approval links + OTPs "sent" to each approver |
| 4 | Open an approval link (copy `link` from mock-mail — it already points at `http://localhost:3000` thanks to `APPROVER_BASE_URL`; no manual host replacement) | Browser (or `/demo` → approver card, which navigates to the same link) | OTP entry screen |
| 5 | Enter the 6-digit code from mock-mail | Browser | Decision screen (request detail) |
| 6 | **Approve** (records snapshot name + timestamp — no name input) | Browser | Approver shows SIGNED |
| 7 | Repeat steps 4–6 for the other 2 approvers | Browser | 3rd approval → **COMPLETED** |
| 8 | Download evidence | `http://localhost:3000/requester/<id>` → **Download PDF** | Real `application/pdf` with title, amount, requester + 3 signature rows |

**Reject path**: any approver can choose **Reject** (inline confirm) instead of Approve — the first reject wins, the request becomes `REJECTED`, all other links show the informational terminal screen.

**Concurrency check (interview demo)**: open the same approval link in two tabs and approve almost simultaneously — exactly one `completedAt` is written and both tabs return the final state. Or have the 3rd approver approve while a reject races — `completed XOR rejected`, never both.

## Local run instructions

### Prerequisites

- Node.js 20+ (`node -v`)
- **pnpm** (`pnpm -v`) — the project package manager (no `npm` lockfiles)
- Docker (only for DynamoDB local — integration tests and the local table)
- AWS credentials are **NOT** required for local development

### Ports

| App | Port | Notes |
|-----|------|-------|
| Backend API (serverless-offline) | **4000** | stage prefix `/dev`, e.g. `http://localhost:4000/dev/api/users` |
| Frontend host (shell) | **3000** | composes the remotes at `/requester*` and `/approve*` |
| requester remote | **3001** | |
| approver remote | **3002** | deep link `/approve?request_id=..&approver_token=..` |
| DynamoDB local (Docker) | **8000** | integration tests only |

### Install (once)

```bash
pnpm install
pnpm -C backend install
pnpm -C frontend/host install
pnpm -C frontend/requester install
pnpm -C frontend/approver install
```

### Run everything

```bash
pnpm -C backend run build    # required on a fresh clone: dist/ is gitignored,
                             # serverless.yml loads handlers from dist/
pnpm run dev                 # backend (:4000) + host (:3000) + requester (:3001) + approver (:3002)
pnpm -C backend run db:create-table   # required after every backend restart:
                                      # the dynamodb-local table is in-memory
                                      # and resets on db:up
```

Or separately:

```bash
pnpm run dev:back    # dynamodb-local + serverless-offline (then db:create-table)
pnpm run dev:front   # host + requester + approver
```

### Backend alone

```bash
pnpm -C backend run dev:all      # dynamodb-local (Docker) + serverless-offline together
# equiv. manually: pnpm -C backend run db:up && pnpm -C backend run dev
```

Smoke test: `curl http://localhost:4000/dev/health` → `{"status":"ok"}`.

The local DynamoDB container is **in-memory** — after every `db:up` you must
recreate the table (it does not auto-provision locally; AWS deploy does):

```bash
pnpm -C backend run db:create-table   # reads the schema from serverless.yml
```

> **APPROVER_BASE_URL note**: the approval links in mock-mail are built by the
> backend's `TokenIssuer` from `APPROVER_BASE_URL`. The template
> (`backend/.env.example`) sets it to `http://localhost:3000` — the host origin,
> which serves the approver remote at `/approve` — so local demo links open the
> composed approver UI directly. Copy it into `backend/.env` (already done in
> the quick path) and restart the backend after changing it.

> **Local evidence note**: `backend/.env.example` sets `EVIDENCE_STORE=memory`,
> so the local backend serves Download PDF from a process-local in-memory
> store — no AWS credentials needed for the demo. Deploy keeps the variable
> **removed** so the S3 adapter is used (see [Deployment](#deployment)).

### Other commands

```bash
pnpm -C backend test                 # unit suite + coverage (global >= 60)
pnpm -C backend run test:integration # against dynamodb-local (needs db:up)
pnpm -C backend run build            # tsc -> dist/
pnpm run test:ci                     # backend + host + requester + approver (full suite)
pnpm run build:ci                    # builds backend + all three frontends
```

## Swagger / OpenAPI

The 12-endpoint contract lives at **`backend/docs/openapi.yaml`** (OpenAPI 3.0):
every endpoint with request/response schemas, the error→HTTP policy, and example
curl flows. It is the authoritative contract to drive the demo and review the API
against the handlers. The interactive source of truth for routes/status codes is
`openspec/changes/purchase-approval-flow/design-api.md`; the OpenAPI file mirrors it
as the machine-readable artifact.

## Deployment

> **Status: documented-pending (8.3 backend / 8.4 frontend).** This sandbox has
> no AWS credentials — the release commands below were authored and validated
> (`pnpm -C backend run build` PASS; `sls deploy` attempted and failed with
> "The security token included in the request is invalid" because only dummy
> local credentials exist), but the actual deploy must run from an environment
> with a real AWS profile. After deploying, fill the placeholders in this
> section and run the post-deploy checks.

### 8.3 — Backend (Lambda + API Gateway + DynamoDB + S3)

**Pre-deploy env cleanup (CRITICAL)** — `serverless-dotenv-plugin` injects
`backend/.env` into the deployed functions, so before deploying:

1. **Empty `DYNAMODB_LOCAL`** in `backend/.env` (or remove the line) — otherwise
   every deployed Lambda points its DynamoDB client at `localhost:8000` and the
   API fails at runtime (the client is built from that env var).
2. **Remove `EVIDENCE_STORE=memory`** — deployed Lambdas must use the S3
   evidence store; a process-local in-memory store would lose every PDF on a
   cold start (the template's local default is memory). The `predeploy` guard
   (`scripts/guard-no-memory-store.mjs`, run by `pnpm -C backend run deploy`)
   FAILS the deploy while it is set.
3. **Set `APPROVER_BASE_URL`** to the frontend origin (CloudFront URL, see 8.4)
   so mock-mail approval links open the approver UI — not the API Gateway URL.
4. Keep `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` pointing at
   your real profile (the dummy local values are for local dev only).

**Deploy:**

```bash
# 1. Build the TypeScript bundle (validated: PASS)
pnpm -C backend run build

# 2. Deploy — provisions the DynamoDB table, S3 bucket, IAM and all functions.
#    Runs `predeploy` FIRST: the deploy guard (scripts/guard-no-memory-store.mjs)
#    FAILS the deploy if EVIDENCE_STORE=memory is still set in backend/.env or
#    the shell environment — the in-memory store must never reach deployed
#    Lambdas (PDFs would be lost on cold start, download 404).
pnpm -C backend run deploy -- --stage dev --region us-east-1
```

**Record after deploy** (from `sls deploy` output → "Service Information"):

| Resource | Where to find it | Placeholder (dev) |
|----------|------------------|-------------------|
| API base URL | output "endpoints" (first URL) | `https://<api-id>.execute-api.<region>.amazonaws.com/dev` |
| DynamoDB table | `${self:custom.tableName}` | `purchase-approvals-dev` |
| S3 evidence bucket | `${self:custom.bucketName}` | `purchase-approvals-evidence-dev` |

**Post-deploy checks:**

```bash
# Health
curl https://<api-id>.execute-api.<region>.amazonaws.com/dev/health   # → {"status":"ok"}

# Binary media types (CRITICAL — offline/tests cannot catch a regression):
# the PDF must download as REAL binary bytes, not a base64 string.
curl -D - -o evidence.pdf -H "Accept: application/pdf" \
  https://<api-id>.execute-api.<region>.amazonaws.com/dev/api/purchase-requests/<id>/evidence.pdf
file evidence.pdf    # must say "PDF document", not ASCII text
```

`serverless.yml` sets `apiGateway.binaryMediaTypes: ['application/pdf', '*/*']`
(PR #5 fresh-review FIX 1) — the check above proves the deployment honors it.

<!-- Frontend deploy steps land in the 8.4 commit. -->

### 8.4 — Frontend (3 bundles → S3 → CloudFront)

The three Module Federation apps are independent static bundles — each goes to
its own S3 bucket, and one CloudFront distribution fronts the **host** bucket
(the host's `remoteEntry.js` tells the browser where the requester and approver
remotes live, so their buckets must be reachable — public-read or an origin
access identity on a second distribution).

**Build each remote with the deployed API base URL** (validated locally: all
three builds PASS with the default `http://localhost:4000`):

```bash
# The API base URL is compiled in via webpack DefinePlugin
# (process.env.API_BASE_URL); point it at the deployed API Gateway stage.
# The HOST bundle additionally needs the REMOTE URLs (webpack reads them at
# build time — see frontend/host/webpack.config.js): point them at the deployed
# requester/approver origins (S3 website endpoints or their CloudFront URLs).
# Without these, a CloudFront-served host would make the viewer's browser fetch
# remotes from ITS OWN localhost and the composed UIs never load.
API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/dev \
  pnpm -C frontend/host run build

# requester and approver bundles: API base URL only (they know their own origin
# via Module Federation `publicPath: auto`).
API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/dev \
  pnpm -C frontend/requester run build
API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/dev \
  pnpm -C frontend/approver run build
```

**Build the host bundle with the deployed remote URLs** (required, or the
composed remotes never load):

```bash
REQUESTER_REMOTE_URL=https://<requester-origin>/remoteEntry.js \
APPROVER_REMOTE_URL=https://<approver-origin>/remoteEntry.js \
  pnpm -C frontend/host run build
```

(Defaults when unset: `http://localhost:3001/remoteEntry.js` and
`http://localhost:3002/remoteEntry.js` — local dev unchanged.)

**Upload to S3 (static website hosting ON, index document `index.html`):**

```bash
aws s3 sync frontend/host/dist s3://purchase-approvals-host-<stage> --delete
aws s3 sync frontend/requester/dist s3://purchase-approvals-requester-<stage> --delete
aws s3 sync frontend/approver/dist s3://purchase-approvals-approver-<stage> --delete
```

**CloudFront:**

1. Create a distribution with origin = the **host** bucket's website endpoint
   (or use OAI for private buckets).
2. Error page → `index.html` with 404 (SPA routing: `/requester/:id` and
   `/approve` deep links must fall back to the host shell).
3. Record the distribution domain name.

**Record:** CloudFront URL = `https://<cloudfront-distribution>.cloudfront.net`

**APPROVER_BASE_URL (deployed)** — set the backend env var to the CloudFront URL
so mock-mail approval links open the composed approver UI:

```bash
# backend/.env (before `sls deploy`, see 8.3)
APPROVER_BASE_URL=https://<cloudfront-distribution>.cloudfront.net
```

**Post-deploy check:** open
`https://<cloudfront-distribution>.cloudfront.net/requester` — the composed UI
must be STYLED (the CSS-ships-through-exposed-graph invariant; a raw unstyled
page means the exposed module graph regressed — see MANUAL-TESTING PR #6 smoke
check). Then create a request, read `/mock-mail` on the deployed API
(`https://<api-id>.execute-api.<region>.amazonaws.com/dev/mock-mail`), open an
approval link on the CloudFront URL and complete the OTP flow.

## Assumptions

Authoritative list: `openspec/changes/purchase-approval-flow/proposal.md`. Key ones:

1. **Roles are positional** — requester/approver are derived from where a user is referenced in a request, not stored (a user can be an approver on one request and the requester on another).
2. **Signature = registered snapshot name + timestamp** after OTP validation — consent evidence, not a cryptographic signature (assignment allows "name + date or simulated signature image").
3. **Exactly 3 distinct approvers** per request, all different from the requester; amount positive, ≤2 decimals, USD.
4. **Rejection is terminal** (first reject wins → global `REJECTED`; other links become informational).
5. **Names are snapshotted** at request creation — evidence (PDF) is immutable even if a user changes name/position later.
6. **Expiry is enforced in code**; DynamoDB TTL is asynchronous cleanup only.
7. **3 failed OTP attempts lock the approver out** (no auto-recovery).
8. **Mock mail is the demo inbox** — `GET /mock-mail` discloses links and OTPs for QA; production would use SES.
9. **Mobile client is deferred** (`mobile/` study phase, out of scope for this change).

## Auth disclaimer

> **Email-only identity is a DEMO limitation, not production authentication.** Users
> register with name + email (no password); the only access gate is the unique
> approval link + OTP, and the consent signature is recorded evidence, not a
> cryptographic (PKI) signature.
>
> **Production would use**: Amazon Cognito or JWT-based auth (verified identity,
> password/SSO, session expiry, MFA), real SES delivery (instead of mock-mail),
> and observability (X-Ray/CloudWatch alarms, audit log for signature events).
> These are documented evolutions, not omissions — see `backend/DECISIONS.md`
> entries 10 (email-only identity), 21 (mock mail → SES), and the deployment
> section above.

## Testing

```bash
pnpm run test:ci    # backend + host + requester + approver, coverage >= 60% each
pnpm -C backend run test:integration   # CAS concurrency races, against dynamodb-local
```

CI (`.github/workflows/ci.yml`) runs: typecheck, backend build, backend unit tests,
all three frontend builds + tests, integration suite against a real `dynamodb-local`
container, and the root `test:ci` — on every push to `main` and every PR.

## Repository layout

| Path | What |
|------|------|
| `backend/` | Serverless API — domain/application/infrastructure/api, Jest (unit + integration), `serverless.yml`, `docs/openapi.yaml` |
| `frontend/host` | Module Federation shell (port 3000) |
| `frontend/requester` | Requester remote (port 3001) |
| `frontend/approver` | Approver remote (port 3002) |
| `mobile/` | React Native study (deferred) |
| `openspec/` | SDD artifacts: proposal, specs, design, tasks |
| `MANUAL-TESTING.md` | Step-by-step curl + UI manual test guide |
| `backend/DECISIONS.md`, `frontend/DECISIONS.md` | Interview-ready decision logs with tradeoffs |
