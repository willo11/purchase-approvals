# Tasks: Purchase Approval Flow

Force-chained delivery. **8 PRs**: `#0 bootstrap` + 7 capability PRs (backend-first, then frontend). Each capability = ONE coherent PR merged to `main` in order; each branch created from latest `main` after the previous merged, so builds are sequential and conflict-free. Review budget = 800 changed lines/PR (user-set; overrides the 400 default). Work-unit commits keep tests + docs with the code they verify.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Review budget | 800 changed lines per PR (user-set) |
| Chained PRs recommended | Yes |
| Chain strategy | stacked-to-main (each PR merges to main in order) |
| 400-line budget risk | High (per-PR >400; within the adopted 800 budget) |
| Delivery strategy | ask-on-risk (strategy already user-confirmed) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

No capability needs a size exception: estimates below keep every PR within the 800-line budget. `#3 approver-otp` and `#4 approval-signature` are closest to budget — keep each in ONE PR and monitor additions. Suppose >800: split the PDF handler into `#5` earlier, never mid-capability.

## Suggested Work Units

| PR | Unit | Est. lines | Base | Budget flag |
|----|------|-----------|------|-------------|
| #0 | bootstrap scaffold | ~700 | main | ok |
| #1 | user-registry | ~550 | main (after #0) | ok |
| #2 | purchase-request | ~750 | main (after #1) | near |
| #3 | approver-otp | ~800 | main (after #2) | near ⚠️ |
| #4 | approval-signature | ~780 | main (after #3) | near ⚠️ |
| #5 | pdf-evidence | ~520 | main (after #4) | ok |
| #6 | requester-panel | ~620 | main (after #5) | ok |
| #7 | approver-flow | ~500 | main (after #6) | ok |
| #8 | release & docs | ~450 | main (after #7) | ok |

Total estimated: ~5,670 changed lines.

---

## PR #0 — Bootstrap (before #1)

> **Monorepo decision to confirm**: NOT a workspace tool (no npm workspaces/turborepo/lerna). Three independent folders `backend/`, `frontend/`, `mobile/`, each with its own `package.json`. Root `package.json` optional, convenience scripts only. `mobile/` stays out of scope for this change (deferred).

- [ ] 0.1 `backend/package.json` (TS, jest, ts-jest, serverless, pdf-lib, aws-sdk v3 deps) + `tsconfig.json` + `.gitignore`.
- [ ] 0.2 `backend/jest.config.js`: `coverageThreshold` global 60 (spec R9/config); unit vs integration (`dynamodb-local`) project setups.
- [ ] 0.3 Clean-architecture folder skeleton: `backend/src/{domain,application,infrastructure,api,handlers}` empty entry + trivial `health` handler wired in `serverless.yml` (functions + DynamoDB table + GSI1 + TTL on `otpExpiresAt` + S3 bucket).
- [ ] 0.4 Integration harness: `docker-compose`/script launching `dynamodb-local`; `DYNAMODB_LOCAL` env guard (design: single table `PK`/`SK`/`GSI1`/`ttl`).
- [ ] 0.5 `frontend/` webpack-5 Module Federation scaffold: `host` + remotes `solicitante`, `aprobador`, each an empty page; `shared:{react:{singleton:true}}` + `React.lazy`/`Suspense` (frontend Decisions 1,3).
- [ ] 0.6 Root `README.md` skeleton, root `.gitignore`, CI test script (`test:ci` runs backend + each frontend remote).
- [ ] 0.7 Update `openspec/config.yaml`: set `apply.test_command`, `verify.test_command`, record Jest/dynamodb-local in `testing:` capabilities.

Verify: `npm test` in backend runs, `npm run build` in each frontend remote produces bundles, health endpoint responds.

---

## PR #1 — user-registry

> **Concept**: The registry is the identity source for every other capability. Email = natural key (`PK=USER#<email>`). Role is POSITIONAL (requester/approver derived from where a user is referenced), not stored. No password — email-only demo identity (Decisions 9,10).

- [ ] 1.1 `domain/User.ts` (name, email, cargo) + `domain/values/Email.ts` + `domain/enums/` as needed — zero framework deps.
- [ ] 1.2 `application/RegisterUser.ts` use-case (empty name/email → 400; duplicate → 409) + its `UserRepository` port (assert conditional `PutItem`, no overwrite).
- [ ] 1.3 `application/ListUsers.ts` use-case + port (creation order).
- [ ] 1.4 `infrastructure/DynamoDbUserRepository.ts` (put w/ dup prevention `ConditionExpression`, query via GSI).
- [ ] 1.5 `api/handlers/userRegistry.ts`: `createUser` → 201/400/409, `listUsers` → 200 via error→HTTP mapper (design-api policy).
- [ ] 1.6 Unit tests: fluent fake repo; `POST /api/usuarios` 201/409/400 (spec R1 scenarios); list empty + non-empty (R2).
- [ ] 1.7 Integration (dynamodb-local): register + duplicate + list real round-trip.
- [ ] 1.8 Append DECISIONS.md entry (email key, cargo optional default, no-password).

Verify: suite green, >=60% coverage.

---

## PR #2 — purchase-request

> **Concept**: The aggregate. Snapshots `createdBy`/`approvers` names at creation (evidence must not break if identity changes, Decisions 3). Global state `Pendiente`->`Completada|Rechazada` dominates all gates (Completada > Rechazada > Pendiente). Tokens + mail are issued via ports implemented in PR #3.

- [ ] 2.1 `domain/` `PurchaseRequest`, `Approver`, enums `GlobalStatus`, `Amount` value object (positive, <=2 decimals, USD) (design-api `RequestShape`).
- [ ] 2.2 `application/CreateRequest.ts`: validate title/description/amount/3 distinct approvers != requester; resolve emails against `UserRegistryPort` (unknown → 404); snapshot names; persist `REQ` + 3 `APPR#<email>` records (Pendiente); emit `TokenIssuerPort` + `MailPort` calls (implemented PR #3).
- [ ] 2.3 `application/ListRequests.ts` (newest first via GSI1) + `GetRequestDetail.ts` (404 unknown; per-approver status view).
- [ ] 2.4 `infrastructure/DynamoDbRequestRepository.ts` (REQ + APPR records, GSI list, detail with approver query).
- [ ] 2.5 `api/handlers/purchaseRequest.ts`: `create` (201/400/404), `list` (200), `detail` (200/404).
- [ ] 2.6 Unit tests: validation scenarios (unknown email, duplicate approver, requester==approver, bad amount/count — spec R1); snapshots; global-state precedence (R2).
- [ ] 2.7 Integration (dynamodb-local): create writes REQ + 3 APPR + list ordering + detail.
- [ ] 2.8 Append DECISIONS.md (aggregate, positional role, naive snapshot).

Verify: suite green, >=60%.

---

## PR #3 — approver-otp

> **Concept**: Access gate. OTP lives in its OWN TTL item (`OTP#<req>#<email>`, 3-min) so table TTL never deletes the durable approver record (Decisions 4). Expiry validated IN CODE; TTL is cleanup. Lockout (`tokenStatus=INVALIDATED_LOCKOUT`) lives on the durable approver item, set atomically when attempts reach 3. Gate chain: request terminal? -> approver lockout? -> token matches + OTP valid? (concurrency detail §2, §6).

- [ ] 3.1 `domain/` OTP value object + `Token` (url-safe uuid) + `OtpService` (generate 6-digit, sha256 hash).
- [ ] 3.2 Implement `TokenIssuerPort` (from 2.2): uuid per approver URL `https://<host>/approve?solicitud_id=<id>&approver_token=<uuid>` (spec R1).
- [ ] 3.3 `infrastructure/MockMailRepo` (MAIL type rows) implementing `MailPort`; `api/handlers/mockMail.ts` `list` → `GET /mock-mail` newest first (R2).
- [ ] 3.4 `application/IssueOtp.ts` (R3/R7 gate chain: terminal 410, lockout 403, issues hash+TTL via mail).
- [ ] 3.5 `application/ValidateOtp.ts` (R4/R5): in-code expiry, consume OTP on success, `attempts<3` conditional counter + atomic lockout at 3, `{attemptsRemaining}` on 401.
- [ ] 3.6 `application/RegenerateOtp.ts` (R6): only if `tokenStatus=ACTIVE`, fresh hash+TTL, reset attempts.
- [ ] 3.7 `infrastructure/DynamoDbApproverRepository.ts` + OTP repo (TTL attribute) + `api/handlers/otp.ts` (`issue`/`validate`/`regenerate`).
- [ ] 3.8 Unit tests: gate precedence, unique tokens, hash-only storage, expiry-in-code before TTL cleanup, lockout at 3, regenerate-on-expired (spec R2/R4/R5/R6/R7).
- [ ] 3.9 Integration (dynamodb-local): issue→validate→consume one-time; 3-fail lockout; regenerate path.
- [ ] 3.10 DECISIONS.md (dedicated TTL item, in-code expiry, atomic lockout).

Verify: suite green, >=60%. Flag if near 800 — keep PDF handler out.

---

## PR #4 — approval-signature

> **Concept**: The interview-core concurrency decision. The REQUEST item is the single CAS lock (`ConditionExpression` = compare-and-swap). Approve: Step A approver commit, then read set; only when 3 signed issue Step B completion CAS (`attribute_not_exists(completedAt)`) — exactly one writer wins, loser gets 409 and must NOT generate. Reject: approver commit, then REQ CAS `status=Pendiente AND attribute_not_exists(rejectedAt)` — only first reject wins; if a concurrent approve already CAS'd `Completada`, reject loses (design-concurrency §3,§4).

- [ ] 4.1 `application/ApproveRequest.ts`: GateChain (terminal/lockout/already-acted); Step A `UpdateItem APPR status_signed` cond `attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)`; signature = registered snapshot name + timestamp (spec R1 — no typed name).
- [ ] 4.2 Completion: read approver set; count `status_signed`; if ==3 issue Step B REQ CAS `attribute_not_exists(completedAt)`; on `ConditionalCheckFailed` re-read and return state, DO NOT generate (R3/R4).
- [ ] 4.3 `application/RejectRequest.ts`: Step A `status_rejected` cond; Step B REQ CAS `status=Pendiente AND attribute_not_exists(rejectedAt)` (R2 terminal global; other links blocked informational).
- [ ] 4.4 Define `EvidenceGeneratorPort` (used by the completion CAS winner; implemented PR #5).
- [ ] 4.5 `api/handlers/signature.ts`: `approve` (201/404/401/409/410), `reject` `{confirm:true}` same codes (design-api).
- [ ] 4.6 Unit tests: approve uses registered name (R1); signature recorded once + no double-sign (R4); reject terminal + blocks others (R2); third-signature completes (R3); **assert emitted `ConditionExpression`** for both CAS steps on fake repo.
- [ ] 4.7 Integration CAS tests (dynamodb-local): `Promise.all` two concurrent approves → exactly one `completedAt`, both signatures recorded; approve-vs-reject race → exactly one winner; same-approver repeat → 409.
- [ ] 4.8 DECISIONS.md (single CAS lock, approve-vs-reject single winner).

Verify: suite green, >=60%. Near-budget — monitor.

---

## PR #5 — pdf-evidence

> **Concept**: pdf-lib with standard `StandardFonts.Helvetica` — pure TS, zero native deps for Lambda (Decisions 7). "Solicitante" resolved from `createdBy.name`. PDF idempotency via deterministic `evidenceKey` (`reqs/<id>/evidencia.pdf`) + `attribute_not_exists(evidenceKey)` guard; generation failure keeps `Completada`, download 404 (spec R4).

- [ ] 5.1 Implement `EvidenceGeneratorPort` (from 4.4): `infrastructure/PdfGenerator.ts` — pdf-lib, request data + "Solicitante: <createdBy.name>" + 3 signature rows (name + timestamp) (spec R1).
- [ ] 5.2 `infrastructure/S3EvidenceStore.ts` (`PutObject` evidenceKey `reqs/<id>/evidencia.pdf`, `ContentType: application/pdf`, `GetObject`) (R2).
- [ ] 5.3 Wire completion: guard `attribute_not_exists(evidenceKey)` read before generate; on CAS win generate→S3→`UpdateItem REQ SET evidenceKey`; on failure log, keep `Completada`, no `evidenceKey`.
- [ ] 5.4 `api/handlers/evidence.ts` `download`: 200 `application/pdf` when exists; 404 if not completed/not found (R3).
- [ ] 5.5 Unit tests: PdfGenerator output contains "Solicitante: Carol" + 3 rows; failure keeps `Completada`; download 200/404 (spec R1/R3/R4).
- [ ] 5.6 Integration (dynamodb-local): 3rd approve triggers generation, evidenceKey set, GET returns PDF bytes.
- [ ] 5.7 DECISIONS.md (pdf-lib Helvetica, existence-key idempotency).

Verify: suite green, >=60%.

---

## PR #6 — requester-panel (frontend)

> **Concept**: Micro-front-end split by bounded context, not by layer (Decisions 1). Host = shell + routing chassis that lazy-loads remotes. `solicitante` owns `/solicitante*`. State lives in the backend; apps never talk to each other — the APIs are the only contract (design-api mapping). Every axios call maps to endpoints #2/#3/#4/#5/#6.

- [ ] 6.1 Host shell: React.lazy+Suspense routes mounting remotes.
- [ ] 6.2 `solicitante` list screen → `GET /api/solicitudes`, empty-state (requester-panel R1), newest first.
- [ ] 6.3 Create form: requester + 3 approver selectors from `GET /api/usuarios`, requester != approvers constraint, submit → `POST /api/solicitudes`, surface validation errors, navigate to detail (R2).
- [ ] 6.4 Detail screen: per-approver status table (Pendiente/Firmado/Rechazado) (R3); "Download PDF" button only when `Completada` → blob `GET .../evidencia.pdf` (R4).
- [ ] 6.5 axios service + mappers (DTO → component shape); error surfaced without crash (R5).
- [ ] 6.6 Jest+RTL: render list (2 requests + empty), create form user-list + validation error, detail table, PDF-button visibility (scenarios R1-R5) with mocked axios.
- [ ] 6.7 Coverage >=60% in `solicitante` jest config; DECISIONS.md frontend entry.

Verify: remote suite green, build ok.

---

## PR #7 — approver-flow (frontend)

> **Concept**: `aprobador` remote owns `/approve`. Driver = the terminal gate: terminal state overrides everything. OTP entry, lockout, and regenerate are distinct UI states driven by HTTP codes (#7/#8/#9). Approve never asks for a name (registered snapshot), Reject requires confirm (approver-flow R1-R4). Calls map to #7-#11.

- [ ] 7.1 Link resolution screen: read `solicitud_id` + `approver_token`; `POST .../otp` → terminal (410) / lockout (403) / OTP entry (R1).
- [ ] 7.2 OTP entry: 6-digit input → `POST .../otp/validate`; wrong code shows `{attemptsRemaining}`; 3rd → lockout screen; expired → "generate new OTP" `POST .../otp/regenerate` (R2).
- [ ] 7.3 Detail + Approve/Reject: show request, Approve → `POST .../approve` (no name input), Reject → `POST .../reject` with `{confirm:true}` (R3).
- [ ] 7.4 Terminal screens: already-signed / already-rejected / completed; no actions (R4).
- [ ] 7.5 axios service + state machine (gate → entry → detail → terminal); 410/403/401 mapping.
- [ ] 7.6 Jest+RTL: rejected link shows informational screen; correct OTP advances; lockout after 3rd; regenerate; approve-without-name; post-action terminality (scenarios R1-R4).
- [ ] 7.7 Coverage >=60%; DECISIONS.md frontend entry.

Verify: remote suite green, build ok.

---

## PR #8 — Release & Docs (non-capability)

> **Concept**: The assignment's documentation + deployment deliverables. Auth disclaimer is REQUIRED (email-only identity = demo limitation, Cognito/JWT documented). Swagger is the 12-endpoint contract reviewers use to drive the demo (lives in `backend/docs/`).

- [ ] 8.1 Root `README.md`: run backend (serverless-offline + DYNAMODB_LOCAL), run frontend, end-to-end demo walkthrough (register → create → mock-mail → OTP → 3 approvals → Completada + PDF), assumptions, **auth disclaimer**.
- [ ] 8.2 Swagger/OpenAPI `backend/docs/openapi.yaml`: all 12 endpoints (#1-#12) with schemas, error→HTTP policy (design-api), example curl flows (spec tests).
- [ ] 8.3 Deploy backend: `sls deploy` (Lambda+API Gateway+DynamoDB+S3); record deployed URLs in README.
- [ ] 8.4 Deploy frontend: build 3 bundles, upload to S3 bucket + CloudFront; record URLs.
- [ ] 8.5 `DECISIONS.md` upkeep both folders; verify `openspec/config.yaml` test commands final; CI full-suite pass (backend + both remotes) with >=60%.

Verify: deployed URLs live; both suites green on CI; swagger flows reproducible.

---

## Implementation Order Summary

Run PRs in order **#0 → #8**, backend first (#0-#5), then frontend (#6-#7), then release (#8). Each merges to `main`; the next branch is cut from updated `main`, keeping diffs conflict-free. The `approval-signature` (#4) CAS tests and the `approver-otp` (#3) TTL/lockout tests are the highest-review-risk slices — keep them in their own PR and flag additions before merging if >800.