# Proposal: Purchase Approval Flow

## Intent

Deliver a serverless purchase-approval flow: employees register (name + email + cargo); a requester creates purchase requests with 3 approvers (all registered employees); each approver receives a unique link + time-limited OTP, signs or rejects; when all 3 sign, the backend generates PDF evidence and marks the request "Completada". This turns the empty `backend/`/`frontend/` scaffold into a working end-to-end AWS demo meeting the assignment's testing, documentation, and deployment deliverables.

## Scope

### In Scope
- User registry: `POST /api/usuarios` (register: name, email, cargo), `GET /api/usuarios` (list); email = unique natural key (`PK=USER#<email>`).
- Backend (first slice): Node.js + TypeScript, Clean Architecture (`domain/`, `application/`, `infrastructure/`, `api/`).
- Serverless AWS via Serverless Framework: Lambda handlers, API Gateway REST, DynamoDB single-table, S3 for PDFs.
- Request lifecycle: create/list/detail; per-approver status (Pendiente / Firmado / Rechazado); global terminal states.
- Approver flow: unique UUID token per approver, simulated email (mock mail), OTP (6-digit, SHA-256, 3-min TTL, 3 attempts).
- Signature: registered name + timestamp (from User snapshot, not typed at signing); PDF evidence (pdf-lib, 3 signature slots) on 3/3 signed; download endpoint `/api/solicitudes/{id}/evidencia.pdf`.
- Mock mail: mail events table + `GET /mock-mail` for demo/QA.
- Frontend: React 18, axios, React Router, webpack 5 Module Federation (host + `solicitante`, `aprobador` remotes).
- Tests >=60% coverage (backend Jest + dynamodb-local; frontend Jest + RTL); README; Swagger/OpenAPI; deployment URLs.

### Out of Scope
- Authentication/authorization: email-only identity for the demo (no password); unique link + OTP is the only gate. Real auth (Cognito/JWT) is a future improvement.
- Handwritten signature images (signature = name + date/time only).
- Rejection recovery: reassignment/reintento (future improvement only).
- Step Functions state machine (documented as evolution option for the completion flow, not built).
- Mobile: React Native app is a SEPARATE later phase (minimal study: create request + show 3 approval links); NOT part of this change.
- Real email/SMS OTP delivery.

## Product Assumptions (authoritative, from question round)

- Roles = cargo: the assignment's "three distinct roles" means three distinct EMPLOYEES (persons) with their cargo. Within a purchase, role is POSITIONAL: `createdBy` = solicitante, `approvers[3]` = aprobadores. Role is derived from structure, not stored as a field on the purchase.
- Signature name comes from the approver's registered User snapshot, not typed at signing time.
- No auth anywhere; email-only identity. Anyone can register/list; unique link + OTP gates approver actions.
- Rejection is TERMINAL for the whole request: any single rejection → "Rechazada"; other links become inert ("already rejected").
- Signature = name + date/time; PDF generated only when all 3 signed.
- Global state dominates: Completada (3/3 signed) > Rechazada (any reject) > Pendiente. Link/OTP validation checks global state first; terminal states surfaced in UI.
- OTP: 3 failed attempts → token invalidated; expired → "generate new OTP" (simulated re-send via mock mail).
- Approver screens: (a) OTP entry, (b) detail + Approve/Reject, (c) terminal-state screens.
- UI status labels follow assignment terms: Pendiente, Firmado, Rechazado, Completada.

## Functional Requirements Summary

- FR1 User registry: register/list employees (name, email, cargo); email unique; rejects duplicates and empty cargo.
- FR2 Create request: requester selects own email (solicitante) + 3 approver emails from registered users; validation: approvers distinct and different from requester email; all must exist in user-registry → Pendiente; token generated per approver.
- FR3 Mock mail: simulated email with link (UUID token); exposed via `GET /mock-mail`.
- FR4 OTP: 6-digit, unique per approver, stored SHA-256, valid 3 min (DynamoDB TTL), 3 attempts → invalidate token.
- FR5 Approve: record signature (registered name + timestamp), status Firmado. Reject: Rechazado (+timestamp).
- FR6 Global transitions: 3/3 signed → Completada + PDF; any reject → Rechazada (token inert).
- FR7 PDF: pdf-lib, request data + 3 signature slots; "Solicitante" = `createdBy.name`; saved to S3; `GET /api/solicitudes/{id}/evidencia.pdf`.
- FR8 Requester panel: list + detail with per-approver status; "Download PDF" when Completada.
- FR9 Tests >=60% coverage, thresholds enforced in config.

## Capabilities

> Contract with sdd-spec. `user-registry` is new; the 6 existing specs (`openspec/specs/`) get delta specs for the model/flow changes.

### New Capabilities
- `user-registry`: register/list employees (name, email, cargo); `PK=USER#<email>`; email unique natural key.

### Modified Capabilities
- `purchase-request`: data model (`createdBy`/`approvers` name+email snapshots; approver items `SK=APPR#<email>`); create flow selects registered emails with validation.
- `approver-otp`: approver keyed by email (`SK=APPR#<email>`); token/OTP per approver email.
- `approval-signature`: signature name from registered User snapshot, not typed at signing.
- `pdf-evidence`: "Solicitante" resolved from `createdBy.name`.
- `requester-panel`: solicitante/approver email selection from registered users list.
- `approver-flow`: approver identity via registered email (no typed name).

## Approach

Backend first, then frontend. Clean Architecture with thin Lambda adapters over use-cases. Single-table DynamoDB: user items `PK=USER#<email>`; request item `PK=REQ#<requestId>`, `SK=REQ#<requestId>` (title, description, amount, `createdBy: {email, name}`, `approvers: [{email, name} x3]`, status); approver items `PK=REQ#<requestId>`, `SK=APPR#<email>` (token, otp, otpExpiresAt TTL 3min, attempts, status, signature `{name, timestamp}`); GSI for requester listing. pdf-lib for PDF. Serverless Framework + serverless-offline + DynamoDB local for dev. webpack 5 Module Federation for React host/remotes. Locked architecture decisions in the assignment brief are authoritative and not re-opened.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/domain/` | New | Entities, value objects, enums incl. User (zero framework deps) |
| `backend/src/application/` | New | Use-cases + ports/interfaces incl. user-registry |
| `backend/src/infrastructure/` | New | DynamoDB repos, mock mailer, PDF gen, S3 storage |
| `backend/src/api/` | New | Lambda handlers, routing, DTOs, validation |
| `backend/serverless.yml` | New | Functions + resources (DynamoDB table, S3 bucket) |
| `frontend/` | New | React 18 host + 2 Module Federation remotes |
| `openspec/` | Modified | `user-registry` spec added; 6 existing specs get deltas |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| OTP race / stale reads across Lambda invocations; token invalidation (concurrency + invalidation kept as design inputs) | Med | Global-state check first; conditional writes; atomic token invalidation |
| pdf-lib font/encoding issues | Low | Standard fonts only; fallback to Helvetica; validate before render |
| Module Federation config complexity | Med | Per-remote builds; shared React singleton; local dev first |
| DynamoDB TTL latency for expired OTP | Low | Validate expiry in code; TTL is cleanup, not the gate |
| Coverage >=60% drift | Med | Enforce thresholds in Jest config from first commit |
| 800-line chained-PR review budget | Med | Force-chained PRs per task; work-unit commits |

## Rollback Plan

- Per slice: revert the PR (force-chained branches; each slice self-contained).
- Deploy: `sls remove` tears down backend stack; delete frontend S3/CloudFront stack.
- Data: demo-only DynamoDB; no migration surface.
- Config: revert `openspec/config.yaml` changes.

## Dependencies

- Node.js 18+, npm; AWS account/credentials for deploy (local dev needs only Docker for dynamodb-local).
- Packages pinned at design: serverless, pdf-lib, react, webpack, Jest, RTL.

## Deliverables

- GitHub repo: `backend/`, `frontend/` full source; `README.md` (assumptions + run/deploy); Swagger/OpenAPI with test instructions; deployment URLs (Lambda + API Gateway + DynamoDB + S3 backend; S3 + CloudFront frontend).
- Auth disclaimer in README/deliverables: email-only identity (no password) is a DEMO limitation; real auth via Cognito/JWT documented as a future improvement.

## First Slice Recommendation

Backend first. Slice 1: domain + application (user-registry, statuses, OTP, signature use-cases) + unit tests. Slice 2: infrastructure (DynamoDB, mock mail, PDF, S3) + integration tests. Slice 3: API/Lambda handlers + swagger. Slice 4: frontend. Slice 5: deploy + docs. Mobile deferred to a separate future change.

## Open Questions

- Amount currency/format (default: USD, 2 decimals — confirm at spec).

## Success Criteria

- [ ] End-to-end demo: register employees → create → mock mail → OTP → 3 approvals → Completada + PDF download, working locally and on deployed URLs.
- [ ] Validation verified: approvers distinct and different from requester; unknown emails rejected.
- [ ] Terminal states verified: reject blocks other approvers; expired OTP and 3-attempt lockout work.
- [ ] Backend and frontend suites pass with >=60% coverage.
- [ ] README + Swagger with test instructions + auth disclaimer; deployment URLs live.
