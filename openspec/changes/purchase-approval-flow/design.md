# Design: Purchase Approval Flow

## Technical Approach

Serverless backend (Node.js + TypeScript, Clean Architecture) over a single-table DynamoDB, plus a micro-frontend host with two remotes (`solicitante`, `aprobador`) via webpack 5 Module Federation. The flow is: register users → requester creates a request (3 approvers) → per-approver UUID token + OTP gate → each approver signs/rejects against registered-name snapshots → 3/3 approves atomically completes the request and triggers PDF evidence (pdf-lib → S3) → download endpoint. Terminal global states (`Completada` > `Rechazada` > `Pendiente`) dominate all gates. Capabilities map to 7 chained PRs; each is independently implementable/testable because modules sit in distinct application/handler modules with mocked ports at unit level and real adapters at integration level.

Reference specs: `openspec/specs/{user-registry,purchase-request,approver-otp,approval-signature,pdf-evidence,requester-panel,approver-flow}/spec.md`. Decisions log conventions: `backend/DECISIONS.md`, `frontend/DECISIONS.md`.

## Architecture Decisions

### Decision: Concurrency owner — conditional writes on the REQUEST item (the global-state holder)

**Choice**: The REQUEST item is the single lock/state owner. Every state transition that changes global status (`Pendiente → Completada | Rechazada`) is a **conditional UpdateItem on the REQUEST item keyed by `attribute_exists`/expected-status**, not on approver items or derived data. Per-approver writes (`Firmado`/`Rechazado`) happen first on the approver item with their own condition, then the global transition is a CAS on the REQUEST.

**Alternatives considered**: (a) A transaction (`TransactWriteItems`) over request + approver — more atomic but couples both records and raises throttling; (b) read-check-then-write in application memory — NOT atomic across Lambda invocations; (c) derive a `Completada` decision by storing an `approvalCount` on the request and letting any approver CAS it — adds a counter that is itself racy.

**Rationale**: Put the rule that must hold exactly once (`Completada` issued once, `Rechazada` once, approve-vs-reject single winner) on ONE item and enforce it with a conditional expression the database checks atomically. This is the interview-core point: DynamoDB `UpdateItem` with `ConditionExpression` is a compare-and-swap that DynamoDB guarantees is atomic; two concurrent writers cannot both pass a condition that requires the pre-state `Pendiente`.

**Exact strategy** (detail: `design-concurrency.md`):
- Approve: `UpdateItem PK=REQ#<id> SK=APPR#<email>` with `ConditionExpression: attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)`, `SET status_signed = :now` (records name+timestamp). Then a **completion check** `UpdateItem PK=REQ#<id> SK=REQ#<id>` with `ConditionExpression: attribute_not_exists(completedAt)`, `SET completedAt = :now, status = 'Completada'`, then **read the approver set** to confirm 3 signed; if confirmed, `attribute_not_exists(evidenceKey)` guards PDF generation.
- Reject: `UpdateItem` on approver item `attribute_not_exists(status_signed)`, `SET status_rejected = :now`; then REQUEST item `UpdateItem` with `ConditionExpression: status = 'Pendiente' AND attribute_not_exists(rejectedAt)`, `SET status = 'Rechazada'`. Because reject is terminal and dominant over pending-but-not-finalized, the condition `status = 'Pendiente'` makes only the FIRST reject win; a concurrent approve that already CAS'd `Completada` makes the reject condition fail.

> Interview flag: Two concurrent writers both pass their per-approver condition (different approvers) but the REQUEST-level CAS is exclusive. Exactly one transitions global state; the loser receives a conditional-check failure and is mapped to a "terminal already resolved" 409/410.

### Decision: Token invalidation source of truth

**Choice**: `invalidated` lives on the **approver item** as `tokenStatus: ACTIVE | INVALIDATED_LOCKOUT`, distinct from the OTP record. The OTP itself is a separate short-lived item (`PK=OTP#<requestId>#<email>`) carrying `otpHash`, `otpExpiresAt` (TTL 3 min). Lockout sets `tokenStatus=INVALIDATED_LOCKOUT` on the approver item atomically (`UpdateItem` conditional on `attempts = 3`). Regenerate writes a NEW OTP item (fresh hash + TTL) and resets `attempts=0` on the approver item but only if `tokenStatus = ACTIVE`.

**Alternatives considered**: putting `invalidated` as a flag inside the OTP item (lost when OTP regenerates), or as a global request field (too coarse — affects all approvers).

**Rationale**: A terminal global state overrides at the gate; a per-approver lockout overrides only that approver. Both must be durable beyond the 3-min OTP TTL, so they live on the approver item. The OTP item TTL only cleans the code, never the token/attempts state.

**Gate precedence** (checked in order, extension "GateChain"): request terminal? → terminal response ; approver `tokenStatus=INVALIDATED_LOCKOUT`? → lockout response ; token matches + OTP unexpired/correct? → proceed. Detail: `design-concurrency.md`.

### Decision: OTP stored as a separate TTL item, not inside approver row

**Choice**: New record type `OTP` keyed `PK=OTP#<requestId>#<email>`, `SK=OTP#<requestId>#<email>`, with `otpHash` (sha256 of the 6-digit code), `otpExpiresAt` = epoch seconds, mapped to the table TTL, `createdAt`, `deliveredAt`.

**Alternatives considered**: storing `otpHash`/`otpExpiresAt` fields on the approver item (previous DECISIONS.md note) — but a row-level TTL on the approver item would delete the approver/signature record, which is wrong; only a dedicated TTL item cleans safely.

**Rationale**: The association problem is solved with a `gs1` (GSI) secondary index for list ordering; the OTP is a pure TTL-scoped value object that should be garbage-collected without touching durable state. Expiry is ALSO validated in code (`otpExpiresAt < now`) because TTL deletion is asynchronous — matches spec R4.

### Decision: Reject vs Completada winner + idempotent PDF timeout

**Choice**: PDF generation keyed by `completedAt` existence; the completion CAS sets `completedAt` and immediately the SAME handler calls `GENERATE_AND_PUT_PDF` guarded by `attribute_not_exists(evidenceKey)`.

**Alternatives considered**: separate Lambda triggered by DynamoDB stream (extra moving part + async gap), retry loop.

**Rationale**: R3 "3rd signature triggers PDF" = the handler that legally transitions `Pendiente→Completada` also generates the PDF. Idempotency: `evidenceKey` is deterministic `reqs/{id}/evidencia.pdf` and S3 `PutObject` overwrite is harmless; the conditional `attribute_not_exists(evidenceKey)` prevents a doubled generation even on redelivery.

### Decision: pdf-lib with standard fonts (no embedding)

**Choice**: `pdf-lib` `StandardFonts.Helvetica` — no custom font file, no `fetchFont` asset, works in plain Lambda (zero native deps).

**Alternatives considered**: custom embedded font (adds a packaged asset + encoding risk in Lambda), pdfmake/pdfkit (heavier, native deps).

**Rationale**: The fake signature is TEXT (registered name + timestamp); standard Helvetica renders Latin-1 text with no binary assets. Interview flag: this is why pdf-lib was chosen over pdfkit — pure TS, no node-gyp binaries in the Lambda runtime.

### Decision: Module Federation host/remote ownership

**Choice**: Host owns shell + routing chassis; `solicitante` remote owns `/solicitante*` (list/create/detail/PDF); `aprobador` remote owns `/approve*` (token gate, OTP, decide). Host lazy-loads remotes through `React.lazy` + `Suspense`.

**Alternatives considered**: host owning all routes and importing remote components; remote owning navigation — rejected (couples remotes to nav details, defeats independent deploy).

**Rationale**: Route ownership per remote keeps the files deployed/composed independently; only the host imports them, so the coupon "who owns the route = who renders it" holds.

## Data Flow

```
POST /api/solicitudes
  → CreateRequest UC (validate approvers ↔ registry, snapshots)
  → PutItem REQ (Pendiente)  ─────▶ PutItem APPR#a, APPR#b, APPR#c (tokens)
  → PutItem OTP items + mail events ─▶ GET /mock-mail reads MAIL type

POST /approvals/{id}/token/{token}/otp
  → GateChain (terminal? lockout? token?) → PutItem OTP (hash, TTL)
POST .../validate → GateChain → conditional approver update (attempts++) → ok?
POST .../approve
  → REQ CAS (Pendiente→Completada w/ 3-signed confirmation)
      └─▶ PDF gen (pdf-lib) → S3 PutObject(evidenceKey)
  → approver item: status_signed = now
POST .../reject
  → REQ CAS (status = Pendiente → Rechazada)  [only first wins]
  → approver item: status_rejected = now
```

## API Contract (full enumeration in `design-api.md`)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | /api/usuarios | {name,email,cargo?} | 201 User | 400, 409 |
| GET | /api/usuarios | — | 200 User[] | — |
| POST | /api/solicitudes | {title,description,amount,requesterEmail,approverEmails[3]} | 201 Request | 400 (unknown/dup/self, amount), 404 registry |
| GET | /api/solicitudes | — | 200 RequestSummary[] | — |
| GET | /api/solicitudes/{id} | — | 200 RequestDetail | 404 |
| POST | /api/approvals/{id}/token/{token}/otp | — | 201 {expiresInSeconds} | 404, 410 terminal |
| POST | /api/approvals/{id}/token/{token}/otp/validate | {code} | 200 {valid:true} | 400 invalid, 401 wrong{attemptsRemaining}, 403 lockout, 410 terminal |
| POST | /api/approvals/{id}/token/{token}/otp/regenerate | — | 201 {expiresInSeconds} | 403 lockout, 410 terminal |
| POST | /api/approvals/{id}/token/{token}/approve | — | 201 RequestDetail | 404, 401, 409 dup, 410 terminal |
| POST | /api/approvals/{id}/token/{token}/reject | — | 201 RequestDetail | 404, 401, 409 dup, 410 terminal |
| GET | /api/solicitudes/{id}/evidencia.pdf | — | 200 application/pdf | 404 (not existing/not completed) |
| GET | /mock-mail | — | 200 MailEvent[] | — |

Every frontend screen maps to these (full table in `design-api.md`): solicitante list→GET /api/solicitudes; create form→GET /api/usuarios then POST /api/solicitudes; detail→GET /api/solicitudes/{id}; PDF button→GET evidencia.pdf; aprobador gate→ POST otp → validate → approve/reject.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/src/domain/*` | Create | Entities (User, PurchaseRequest, Approver), value objects (Amount, Email), enums (GlobalStatus, ApproverStatus, TokenStatus) |
| `backend/src/application/*` | Create | Use-cases + port interfaces, one module per capability |
| `backend/src/infrastructure/*` | Create | DynamoDB repos, MockMailRepo, PdfGenerator, S3EvidenceStore, crypto/clock/id |
| `backend/src/api/*` | Create | Lambda handlers (one per function), DTOs, error→HTTP mapping |
| `backend/serverless.yml` | Create | Single table + GSI1 + TTL, S3 bucket, all functions→routes |
| `backend/tests/*` | Create | Jest unit + integration (dynamodb-local) |
| `frontend/host/*`, `frontend/solicitante/*`, `frontend/aprobador/*` | Create | Module Federation apps |
| `README.md`, `docs/*` | Create | Run/deploy, Swagger, auth disclaimer |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (per capability PR) | Use-cases + domain rules (validation, snapshots, gate precedence, terminality, OTP hash/expiry/lockout) | Jest with injected in-memory fake ports; assert conditional writes emitted with expected ConditionExpression |
| Integration (dynamodb-local) | Concurrency: approve/reject, 3rd-signature single `Completada`, single PDF | Real repos against dockerized DynamoDB, Promise.all of two writes, assert one `completedAt` |
| API handler | HTTP status mapping (409/401/410/404) | supertest against handler adapters with stub ports |
| Frontend (Jest + RTL) | Per remote component (list, form, OTP, approve/reject) + service mappers | Mocked axios; assert render + error surfacing |
| Coverage | >=60% enforced | `coverageThreshold` in jest config (backend + each remote) |

## Migration / Rollout

No migration required (fresh scaffold). Rollout order = capability PR chain: user-registry → purchase-request → approver-otp → approval-signature → pdf-evidence → requester-panel → approver-flow. Backend then frontend at deploy step.

## Open Questions

- [ ] Amount decimal handling: store as number with 2-decimal validation now; note future switch to integer cents (interview point).

## Detail Files

- `design-concurrency.md` — full conditional-expression strategy, gate precedence, race scenarios, and the PDF idempotency guard.
- `design-api.md` — endpoint × frontend mapping, DTOs, status-code policy.