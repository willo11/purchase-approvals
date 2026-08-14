# Purchase Approval Flow

Serverless purchase-approval flow with concatenated digital signatures (web
client). Employees register; a requester creates purchase requests with 3
approvers; each approver signs or rejects behind a unique link + time-limited
OTP; when all 3 sign, the backend generates PDF evidence and the request
becomes **COMPLETED**.

> Skeleton documentation — final polish (assumptions, auth disclaimer, run
> walkthrough, deployment URLs) lands in PR #8 (Release & Docs).

## Stack

- **Backend** (`backend/`): Node.js 20 + TypeScript, Clean Architecture
  (`domain/` / `application/` / `infrastructure` / `api/`), Serverless
  Framework (Lambda + API Gateway), DynamoDB single-table (PK/SK, GSI1, TTL on
  `otpExpiresAt`), S3 (PDF evidence), pdf-lib (standard Helvetica font).
- **Frontend** (`frontend/`): React 18, axios, React Router v6, webpack 5
  Module Federation — host shell + `solicitante` and `aprobador` remotes.
- **Mobile** (`mobile/`): React Native study phase — deferred, separate change.

## High-Level Architecture

- **Serverless backend**: one Lambda handler per endpoint over a single-table
  DynamoDB. The REQUEST item is the concurrency owner: global transitions
  (`PENDING → COMPLETED | REJECTED`) are atomic conditional writes
  (compare-and-swap). See `openspec/changes/purchase-approval-flow/design.md`.
- **Micro-frontends**: the host owns the shell + routing chassis and lazy-loads
  the remotes via `React.lazy`/`Suspense`; each remote is independently built,
  tested (>= 60% coverage) and deployed. The remotes never talk to each other —
  the REST API is the only contract.

## Repository Layout

| Path | What |
|---|---|
| `backend/` | Serverless API, domain/application/infrastructure, Jest (unit + integration) |
| `frontend/host` | Module Federation shell (port 3000) |
| `frontend/solicitante` | Requester remote (port 3001) |
| `frontend/aprobador` | Approver remote (port 3002) |
| `mobile/` | React Native study (deferred) |
| `openspec/` | SDD artifacts: specs, proposal, design, tasks |

## Assumptions

_PLACEHOLDER — finalized in PR #8._ See `openspec/changes/purchase-approval-flow/proposal.md`
for the authoritative assumption list (roles are positional, signature = name +
timestamp, rejection is terminal, etc.).

## Auth Disclaimer

**Email-only identity is a DEMO limitation, not production auth.** Users
register with name + email (no password); the only gate is the unique approval
link + OTP. Real authentication (Cognito/JWT) is a documented future
improvement. See `backend/DECISIONS.md` entry 10.

## Run Instructions

### Prerequisites
- Node.js 20+ (`node -v`)
- **pnpm** v9+ (`pnpm -v`) — the project package manager (`npm` lockfiles are not used)
- Docker (only for DynamoDB local — integration tests)
- AWS CLI credentials are NOT required for local development (no real AWS calls)

### TL;DR — one command each

```bash
pnpm install          # (once) per package: root + backend + each frontend app
pnpm run dev:back    # backend: dynamodb-local + serverless-offline API  (:4000)
pnpm run dev:front   # frontend: host + solicitante + aprobador  (:3000 / :3001 / :3002)
# or `pnpm run dev` to start everything together (from repo root)
```

### Backend (`backend/`) — port **4000**
```bash
cd backend
pnpm install

pnpm run dev:all       # dynamodb-local (docker) + serverless-offline together
# equiv. manually: pnpm run db:up  then  pnpm run dev
```

**What you should see once the API is up:**
- The local API serves at **http://localhost:4000** with the `dev` stage prefix
  (port 3000 is reserved for the frontend host).
- Smoke-test: `curl http://localhost:4000/dev/health` → `{"status":"ok"}`.
- The single DynamoDB table (PK/SK + GSI1 + TTL on `otpExpiresAt`) and the S3
  evidence bucket are declared in `serverless.yml`; real endpoints land with
  each capability PR (user-registry first).

Other commands:
```bash
pnpm test               # unit suite + coverage (global >= 60)
pnpm run test:integration   # runs against dynamodb-local (needs db:up)
pnpm run build          # tsc -> dist/  (pure backend bundle, no tests)
```

### Frontend (`frontend/`) — three independent apps
Use the single command (from the repo root) so you don't open three terminals:
```bash
pnpm run dev:front      # starts host :3000, solicitante :3001, aprobador :3002
```
(Equivalent manually: `cd frontend/<app> && pnpm install && pnpm start` per app.)

**What you should expect:**
- **http://localhost:3000** (host) — the shell: landing/menu with navigation
  pointing to `/solicitante*` and `/approve*`.
- Visiting those routes lazy-loads each remote via Module Federation:
  - `/solicitante*` loads the **solicitante** app from :3001
  - `/approve*` loads the **aprobador** app from :3002
- Currently each remote is a placeholder page (real screens land with PRs #6
  and #7). To verify federation, open http://localhost:3000/solicitante —
  you should see content served by the remote on :3001, not a host error.

### Whole-repo convenience scripts (from repo root, no workspace tool)
```bash
pnpm run dev:back   # all backend services (db + API)
pnpm run dev:front  # all frontend apps (host + 2 remotes)
pnpm run dev        # backend + frontend together
pnpm run test:ci    # backend + host + solicitante + aprobador, coverage >= 60%
pnpm run build:ci   # build everything; proves the whole monorepo compiles
```

## Swagger / OpenAPI

_PLACEHOLDER — lives at `backend/docs/openapi.yaml` (created in PR #8), the
12-endpoint contract used to drive the demo._

## Deployment URLs

_PLACEHOLDER — recorded after deployment in PR #8_ (backend: Lambda + API
Gateway + DynamoDB + S3; frontend: static bundles on S3 + CloudFront).

## Testing

```bash
npm run test:ci   # backend + host + solicitante + aprobador, coverage >= 60%
```
