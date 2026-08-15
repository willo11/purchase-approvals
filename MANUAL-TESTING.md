# Manual Testing — Purchase Approvals

Guide to exercising the system by API with `curl`, without spinning up AWS. Everything
runs locally (DynamoDB in Docker + `serverless offline` on `:4000`). It is updated as
PRs land.

> Current status: **PR #5 — pdf-evidence (backend API)**. The frontend is NOT yet
> connected to the backend (that lands in PR #6 requester-panel and PR #7 approver-flow),
> so manual testing is, for now, 100% backend via `curl`.

---

## Setup (once)

### 1. Credentials → `.env`

Copy the template and adjust it if needed:

```bash
cp backend/.env.example backend/.env   # local values are already ready by default
```

The backend loads `backend/.env` automatically (serverless-dotenv-plugin).
Variables that matter to you:

| Variable | Local value | Note |
|----------|-------------|------|
| `DYNAMODB_LOCAL` | `http://localhost:8000` | Points to DynamoDB in Docker. Remove/empty it to target real AWS at deploy. |
| `TABLE_NAME` | `purchase-approvals-dev` | Single-table name. It must exist locally. |
| `AWS_ACCESS_KEY_ID` / `SECRET` | `local-dummy` | Local only. Never put real credentials here. |

### 2. Start local DynamoDB + create the table

```bash
pnpm -C backend run db:up             # starts dynamodb-local on :8000 (Docker)
pnpm -C backend run db:create-table   # creates purchase-approvals-dev (no AWS CLI)
```

`db:create-table` reads the schema from your `serverless.yml` (PK/SK + GSI1 + TTL) and
creates it locally with `@aws-sdk`. It is idempotent (it tells you if the table already
exists). You do not need the AWS CLI.

### Why create the table by hand (local only)?

DynamoDB **does not auto-provision tables on write**: you create them (or the
infrastructure does). The difference depends on where you run:

| Environment | Who creates the table | Manual? |
|---------|--------------------|----------|
| **AWS (deploy)** | `sls deploy` → **CloudFormation** reads `serverless.yml` and creates `PurchaseApprovalsTable` (with GSI1 + TTL) automatically | No |
| **Local (serverless-offline)** | Nobody. `serverless-offline` runs the Lambdas but does **NOT** provision the CloudFormation resources | Yes, with the `aws create-table` above |

Also, the `amazon/dynamodb-local` container runs **in memory** (this compose does not
use `-dbPath` or mount a volume), so the local table disappears when the container
restarts. Re-create it with the command above after each `db:up`. (Note: the integration
tests create their **own** disposable table, so that one does not serve these curls.)

## Start the backend

```bash
pnpm -C backend run dev        # serverless offline on :4000 (uses the .env)
```

Done: the API is at `http://localhost:4000/dev`.

---

## Endpoints to test

### PR #1 — user-registry (`/api/users`)

```bash
# Smoke — is it alive? → {"status":"ok"}
curl http://localhost:4000/dev/health

# 1. Create employee → 201 + User {name,email,position}
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana","email":"ana@example.com","position":"Analyst"}'

# 2. Duplicate email → 409
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Another","email":"ana@example.com"}'

# 3. Invalid email → 400
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana","email":"not-an-email"}'

# 4. Empty name → 400
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"","email":"b@example.com"}'

# 5. List employees → 200, in creation order
curl -s -w "\nHTTP:%{http_code}\n" http://localhost:4000/dev/api/users
```

**Expected result**: `201 → 409 → 400 → 400 → 200 (with the registered users)`.

### PR #2 — purchase-request (`/api/purchase-requests`)

First register the cast involved in a request (1 requester + 3 approvers). If `ana@example.com`
was already created in the PR #1 run, skip that one:

```bash
for u in "Ruth|ruth@example.com|Manager" "Ana|ana@example.com|Analyst" "Sven|sven@example.com|Director" "Luca|luca@example.com|Compliance"; do
  IFS='|' read -r n m p <<< "$u"
  curl -s -o /dev/null -X POST http://localhost:4000/dev/api/users \
    -H "Content-Type: application/json" -d "{\"name\":\"$n\",\"email\":\"$m\",\"position\":\"$p\"}"
done
```

```bash
# 1. Create request → 201 RequestDetail {status:PENDING, approvers:[3 x {status:PENDING,...}], tokens...}
#    NOTE: copy the returned "id" — you need it for the detail call below.
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/purchase-requests \
  -H "Content-Type: application/json" \
  -d '{"title":"Replace laptops","description":"Swap 3 dev laptops","amount":4500.00,"requesterEmail":"ruth@example.com","approverEmails":["ana@example.com","sven@example.com","luca@example.com"]}'

# 2. Unknown approver email (not in user-registry) → 404
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/purchase-requests \
  -H "Content-Type: application/json" \
  -d '{"title":"Ghost","description":"x","amount":10,"requesterEmail":"ruth@example.com","approverEmails":["ana@example.com","ghost@example.com","luca@example.com"]}'

# 3. Duplicate approver (same email twice) → 400
#    (approver == requester, and invalid amount/count behave the same → 400)
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/purchase-requests \
  -H "Content-Type: application/json" \
  -d '{"title":"Dup","description":"x","amount":10,"requesterEmail":"ruth@example.com","approverEmails":["ana@example.com","ana@example.com","sven@example.com"]}'

# 4. List requests → 200, newest first (use the id captured from step 1)
curl -s -w "\nHTTP:%{http_code}\n" http://localhost:4000/dev/api/purchase-requests

# 5. Detail → 200 (replace YOUR_ID with the id from step 1)
curl -s -w "\nHTTP:%{http_code}\n" http://localhost:4000/dev/api/purchase-requests/YOUR_ID

# 6. Unknown request id → 404
curl -s -w "\nHTTP:%{http_code}\n" http://localhost:4000/dev/api/purchase-requests/does-not-exist
```

**Expected result**: `201 → 404 → 400 → 200 → 200 → 404`. The create response includes the
request `id`, a `PENDING` status, the `createdBy`/`approvers` name snapshots, and one unique
approval token per approver (the real OTP/TTL + DB-backed mock-mail land in PR #3).

> **Local note**: the DynamoDB container is in-memory, so a `db:up` + `db:create-table`
> resets all data. Re-register the users and re-create the request to run these curls again.

---

### PR #3 — approver-otp (access gate) + `/mock-mail`

The approval links and OTPs are not sent by email — they are recorded in the simulated
mailbox (`GET /mock-mail`), which is the demo's inbox. Read it to obtain each approver's
authentication URL (`approver_token=<uuid>`) and their 6-digit code. Everything is per
approver email (each approver lives in their own `OTP#<reqId>#<email>` item).

```bash
# 0. Inbox — shows what was "sent", newest first. Copy one approval link + its OTP.
curl -s -w "\nHTTP:%{http_code}\n" http://localhost:4000/dev/mock-mail

# 1. Place a request so there is an OTP flow to drive (reuse PR #2 curl; local data resets on db:up)
curl -s -o /dev/null -X POST http://localhost:4000/dev/api/purchase-requests \
  -H "Content-Type: application/json" \
  -d '{"title":"Laptop","description":"x","amount":1000,"requesterEmail":"ruth@example.com","approverEmails":["ana@example.com","sven@example.com","luca@example.com"]}'

# 2. Issue OTP for an approver → 201 {expiresInSeconds:180} (replace ID/EMAIL/TOKEN)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/otp \
  -H "Content-Type: application/json" -d '{"email":"ana@example.com"}'

# 3. Validate with the CORRECT code → 201 (OTP is consumed: a 2nd identical call → 410)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/otp/validate \
  -H "Content-Type: application/json" -d '{"email":"ana@example.com","code":"000000"}'

# 4. Bad code → 401 {attemptsRemaining}; 3 bad codes lock the approver out → 403
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/otp/validate \
  -H "Content-Type: application/json" -d '{"email":"ana@example.com","code":"999999"}'

# 5. Expired OTP → use regenerate (only works while the approver is still ACTIVE)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/otp/regenerate \
  -H "Content-Type: application/json" -d '{"email":"ana@example.com"}'
```

**Expected result**: `200 inbox → 201 request → 201 issue → 201 validate → 401 (wrong) → 403 (after 3 fails) → 201/403 regenerate`. The OTP is single-use: validating the same code twice returns 410 on the second. A locked approver is rejected with 403 even with the correct code.

> **Routes/status codes** may vary by one letter if the handler differs from this guide's shape —
> the authoritative table is `openspec/changes/purchase-approval-flow/design-api.md`. If a curl
> doesn't match, first confirm the exact path there.

---

### PR #4 — approval-signature (approve / reject, the concurrency core)

After validating the OTP (PR #3 flow), the approver can approve or reject. The `validatedAt`
marker written by a successful validate is REQUIRED — hitting approve/reject without it
returns **401**. The signature uses the REGISTERED snapshot name + timestamp (never typed).

```bash
# 1. Approve WITHOUT validating OTP first → 401 (validated-OTP precondition)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/approve \
  -H "Content-Type: application/json" -d '{}'

# 2. Validate OTP first (correct code from /mock-mail), THEN approve → 201 RequestDetail
#    NOTE: the approve response returns the CURRENT global state — if another approver
#    already completed it, you get 201 with status COMPLETED (the CAS loser).
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/otp/validate \
  -H "Content-Type: application/json" -d '{"email":"ana@example.com","code":"000000"}'

curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/approve \
  -H "Content-Type: application/json" -d '{}'

# 3. Same approver signs again → 409 (already acted)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/approve \
  -H "Content-Type: application/json" -d '{}'

# 4. Reject requires {confirm:true} → 201 first-reject-wins, global REJECTED
#    (later rejects from other links → 409 already-acted / 410 terminal)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/reject \
  -H "Content-Type: application/json" -d '{"confirm":true}'

# 5. On a COMPLETED request, further action → 410 (terminal)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/approve \
  -H "Content-Type: application/json" -d '{}'
```

**Expected result**: `401 → 201 validate → 201 approve → 409 → 201 reject → 410`. The 3rd
signature completes the request: exactly one `completedAt`, `COMPLETED > REJECTED` precedence,
and the completion-CAS loser returns 201 with the current (already-completed) state — it does
NOT generate evidence. Same-approver repeat is blocked (Step A CAS), and approve-vs-reject
can never land in an inconsistent state (`completed XOR rejected`).

> **Concurrency check**: open the same approval link in two tabs and approve on both almost
> simultaneously — exactly one `completedAt` is set and both requests return the final state.

---

### PR #5 — pdf-evidence (download the generated PDF)

After the 3rd approval completes a request, the completion CAS winner generates the PDF
and stores it under the deterministic key `reqs/<id>/evidence.pdf`; `evidenceKey` lands on
the REQ row. Download it (replace `ID` with the request id from PR #2):

```bash
# 1. Completed request → 200, Content-Type: application/pdf, REAL binary body.
#    `-o evidence.pdf` saves the bytes; `file`/`pdfinfo`/a PDF viewer validates it.
curl -s -D - -o evidence.pdf -H "Accept: application/pdf" \
  http://localhost:4000/dev/api/purchase-requests/ID/evidence.pdf

# 2. Still-PENDING request → 404 (no PDF generated yet)
curl -s -w "\nHTTP:%{http_code}\n" \
  http://localhost:4000/dev/api/purchase-requests/ID/evidence.pdf

# 3. Unknown request id → 404
curl -s -w "\nHTTP:%{http_code}\n" \
  http://localhost:4000/dev/api/purchase-requests/does-not-exist/evidence.pdf
```

**Expected result**: `200 (real PDF bytes) → 404 → 404`. The PDF must contain the request
title/description/amount/date, `Requester: <createdBy.name>`, and exactly 3 signature rows
(name + timestamp).

> **DEPLOYED-API note (CRITICAL — offline cannot catch this)**: the binary body works
> locally AND in every test because `serverless-offline` and the test harness bypass the
> API Gateway boundary. On a REAL REST API v1 deployment, binary responses are only
> base64-decoded when the API declares binary media types — `serverless.yml` sets
> `provider.apiGateway.binaryMediaTypes: ['application/pdf', '*/*']` (fresh-review FIX 1).
> Validate `curl -D - -o evidence.pdf ...` against a DEPLOYED endpoint and confirm the
> saved file opens as a PDF (not a base64 text string).

> **Known gap (spec R4, documented in DECISIONS #23)**: if generation fails, the request
> keeps `COMPLETED` and download stays 404 forever — there is no automatic retry. The
> documented evolution is an idempotent `POST .../evidence/retry` (re-generate when
> `COMPLETED && !evidenceKey`) or the SQS consumer; NOT implemented in this PR.

---

## Clean Code context (to defend in the interview)

The flow verified by these curls is `HTTP → handler → use case → port → DynamoDB`:

```
api/handlers/userRegistry.ts          → HTTP (request/response)
   ▼ calls
application/RegisterUser.ts            → use case (business rules)
   ▼ depends on the PORT (interface)
application/ports/UserRepository.ts   → contract, not implementation
   ▲ implements
infrastructure/DynamoDbUserRepository.ts → adapter (the only layer that knows DynamoDB)
```

- **Atomic dedupe**: conditional `PutItem` (`attribute_not_exists(PK)`) → a duplicate
  email is rejected with 409 with no race condition (it is not get-then-put).
- **Ordered listing**: query by GSI1 (`gsi1sk = createdAt`, `ScanIndexForward: true`).
- **`domain` without a framework**: `User`/`Email` import nothing external.

The purchase-request flow is the aggregate + a richer port set. `CreateRequest` depends on
**four** interfaces (not one):

```
api/handlers/purchaseRequest.ts          → HTTP (composition root: injects adapters)
   ▼ calls
application/CreateRequest.ts             → use case (orchestration + business rules)
   ▼ depends on the PORTS (interfaces)
application/ports/{RequestRepository, UserRegistryPort, TokenIssuerPort, MailPort}
   ▲ implemented by
infrastructure/{DynamoDbRequestRepository, DynamoDbUserRegistry, InMemoryTokenIssuer, LogMailer}
```

- **Aggregate**: `PurchaseRequest` owns the invariant — exactly 3 distinct approvers, all
  different from the requester; `Amount`/`Email` reject bad values in their own constructors.
- **Snapshots**: `createdBy`/`approvers` store `{email,name}` frozen at creation (evidence
  won't break if a position changes later).
- **Dependency inversion**: the use case calls interfaces only; the handler (composition
  root) constructs the concrete adapters and injects them — swap DynamoDB for Postgres by
  changing an adapter, not the domain/use case.
- **Deferred to PR #3**: real OTP/TTL + DB-backed mock-mail. PR #2 defines
  `TokenIssuerPort`/`MailPort` and wires placeholders so the flow runs end-to-end.

The approver-otp flow is the **access gate** — worth defending hard:

```
api/handlers/otp.ts                       → HTTP (issue / validate / regenerate)
   ▼ calls
application/{IssueOtp, ValidateOtp, RegenerateOtp}
   ▼ depends on the PORTS
application/ports/{ApproverGate, OtpService, MockMailPort/MailPort}
   ▲ implemented by
infrastructure/{DynamoDbApproverRepository, DynamoDbOtpRepository, MockMailRepo}
```

- **Gate chain (R7)**: request terminal→**410** · approver locked→**403** · unknown token→**404** ·
  then OTP validation. Each gate short-circuits before the next.
- **Hash-only storage**: the 6-digit code is stored as `sha256(code + requestId#email)` — the
  plaintext is never persisted or compared. TTL (3 min) lives on its OWN `OTP#<email>` item so
  auto-expiry never deletes the durable approver record; expiry is ALSO enforced in code.
- **Single-use (R4)**: validate consumes the OTP with a `ConditionExpression` delete
  (compare-and-swap) — only ONE concurrent submission of the correct code wins; the loser gets
  410. Try the same code twice to prove it.
- **Atomic lockout**: failed attempts use a single conditional `UpdateItem`
  (`SET attempts+1, tokenStatus=locked WHERE tokenStatus=active AND attempts=limitMinusOne`),
  so 3 wrong guesses can never overshoot and lock exactly once (check `/mock-mail` + the OTP
  curls for the 401 → 403 transition).
- **Mock mail as outbox**: `GET /mock-mail` is the demo inbox; `MockMailRepo` writes a row per
  event. Swapping to SES later = one adapter behind `MailPort`.

The approval-signature flow is the **concurrency core** — the strongest interview material:

```
api/handlers/signature.ts                → HTTP (approve / reject)
   ▼ calls
application/{ApproveRequest, RejectRequest}
   ▼ gate first (shared): terminal 410 → token 404 → lockout 403 → already-acted 409
   ▼ then validated-OTP check → 401
   ▼ Step A per-approver CAS → Step B REQ-level CAS
infrastructure/DynamoDb{Approver,Request}Repository  (ConditionExpression CAS)
```

- **The REQUEST item is the single lock**: Step B completion is
  `attribute_not_exists(completedAt) AND #status = :pending` (symmetric with reject) — exactly
  one writer completes; the loser re-reads, returns 201 with the completed state, and does NOT
  generate. `completed XOR rejected` by construction.
- **Step A per-approver CAS**: `attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)` —
  the same approver can never sign twice nor sign AND reject.
- **Signature = registered snapshot name + timestamp** (R1): no typed name in the payload.
- **Validated-OTP precondition → 401**: approve/reject require the `validatedAt` marker that a
  successful validate wrote on the approver row (the demo's proof of OTP possession).
- **ConsistentRead on the completion trigger** (no stuck-PENDING when 2 approvers sign concurrently).

## Checklist

- [ ] `backend/.env` created from `.env.example`
- [ ] `dynamodb-local` running (`db:up`) and `purchase-approvals-dev` table created
- [ ] `pnpm -C backend run dev` responds on `:4000`
- [ ] The 5 PR #1 curls return `201 → 409 → 400 → 400 → 200`
- [ ] The PR #2 curls return `201 → 404 → 400 → 200 → 200 → 404`
- [ ] The PR #3 flows return `201 issue → 201 validate → 401 (wrong) → 403 (after 3) → regenerate`
- [ ] The PR #4 flows return `401 (no OTP) → 201 approve → 409 (repeat) → 201 reject → 410 (terminal)`
- [ ] The PR #5 flows return `200 (real PDF bytes) → 404 (pending) → 404 (unknown id)` and the downloaded file opens as a PDF
- [ ] (Deploy-only) `evidence.pdf` downloads as a real binary on a DEPLOYED API — `apiGateway.binaryMediaTypes` is set; offline cannot prove it