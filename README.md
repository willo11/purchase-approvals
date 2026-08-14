# Purchase Approval Flow

Serverless purchase-approval flow with concatenated digital signatures (web
client). Employees register; a requester creates purchase requests with 3
approvers; each approver signs or rejects behind a unique link + time-limited
OTP; when all 3 sign, the backend generates PDF evidence and the request
becomes **Completada**.

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
  (`Pendiente → Completada | Rechazada`) are atomic conditional writes
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

_PLACEHOLDER — full walkthrough in PR #8._ Quick start:

```bash
# Backend (needs Docker for integration tests only)
cd backend && npm install
npm run db:up          # dynamodb-local on :8000 (integration tests only)
npm test               # unit suite + coverage threshold 60
npm run test:integration
npm run build          # tsc -> dist/

# Frontend (three independent apps)
cd frontend/host && npm install && npm start          # :3000
cd frontend/solicitante && npm install && npm start   # :3001
cd frontend/aprobador && npm install && npm start     # :3002
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
