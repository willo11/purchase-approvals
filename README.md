# Purchase Approval Flow

**MVP: serverless purchase-approval workflow with CONSENT SIGNATURE and immutable evidence.** Flow: create request → unique link per approver → OTP → approve/reject with CAS → PDF evidence on completion. Architecture: Lambda + API Gateway + DynamoDB single-table + S3, clean architecture, micro-frontends with Module Federation, unit + integration + concurrency tests, CI.

It is **not** a payment system and **not** PKI/cryptographic signing — the "signature" is registered consent evidence: registered snapshot name + timestamp after OTP validation (the assignment allows "name + date or a simulated signature image").

## Quick path (5 minutes to a working demo)

```bash
# 1. Install (once)
pnpm install && pnpm -C backend install && pnpm -C frontend/host install && \
  pnpm -C frontend/requester install && pnpm -C frontend/approver install

# 2. Start everything (backend on :4000, frontends on :3000/:3001/:3002)
pnpm run dev
```

Open **http://localhost:3000/requester** → create a request → open
**http://localhost:3000/mock-mail** (the demo inbox) → open an approval link →
enter the OTP → approve → repeat for 3 approvers → **COMPLETED** + **Download PDF**.

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
| 1 | Register 4 employees (1 requester + 3 approvers) | `POST /api/users` or the create form's user selectors | Users in registry |
| 2 | Create a purchase request (title, amount, requester + 3 distinct approvers) | `http://localhost:3000/requester/new` | Request `PENDING`, 1 unique approval link per approver |
| 3 | Open the demo inbox | `http://localhost:3000/mock-mail` | Approval links + OTPs "sent" to each approver |
| 4 | Open an approval link (copy `link` from mock-mail, replace host with `http://localhost:3000`) | Browser | OTP entry screen |
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
pnpm run dev        # backend (:4000) + host (:3000) + requester (:3001) + approver (:3002)
```

Or separately:

```bash
pnpm run dev:back    # dynamodb-local + serverless-offline
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
> backend's `TokenIssuer` from `APPROVER_BASE_URL` (default
> `http://localhost:4000` — the backend itself). For the demo, the link host must
> point at the **frontend origin** (`http://localhost:3000`), which serves the
> approver remote at `/approve`. Set it in `backend/.env`:

```bash
# backend/.env
APPROVER_BASE_URL=http://localhost:3000
```

then restart the backend before creating requests, so mailed links open the
composed approver UI instead of hitting the API Gateway URL.

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

> **Status: documented-pending.** This sandbox has no AWS credentials, so the
> exact release commands and post-deploy record steps are documented in the
> backend and frontend deployment sections below. They were not executed here —
> run them from an environment with an AWS profile configured, then fill the
> placeholders. See task 8.3 (backend) and 8.4 (frontend) in
> `openspec/changes/purchase-approval-flow/tasks.md`.

<!-- Backend deploy steps land in the 8.3 commit; frontend deploy steps in 8.4. -->

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
