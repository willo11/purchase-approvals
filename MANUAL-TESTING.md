# Manual Testing — Purchase Approvals

Guide to exercising the system by API with `curl`, without spinning up AWS. Everything
runs locally (DynamoDB in Docker + `serverless offline` on `:4000`). It is updated as
PRs land.

> Current status: **PR #9 — demo fixes (POST-RELEASE)**. All capabilities are in:
> backend (PRs #1–#5), requester panel (PR #6), approver flow (PR #7), release
> & docs (PR #8). This PR adds demo polish: per-recipient inbox filtering
> (`GET /mock-mail?to=`), the host demo hub (`/`) + approver console (`/demo`),
> the local in-memory evidence store (`EVIDENCE_STORE=memory`, Download PDF
> without AWS), `APPROVER_BASE_URL` pre-set for local approval links, the
> requester empty-users seed hint, and the one-shot `pnpm run demo:setup`.
>
> **PR #10 — demo seed scenarios**: `pnpm -C backend run db:seed-scenarios`
> seeds 4 ready-made demo states (rejected / completed / regenerated OTP /
> fresh) by driving the real API, plus walkthrough tips on the demo hub.
>
> **PR #11 — lockout recovery (POST-RELEASE feature)**: requester-initiated
> recovery of a LOCKED approver's OTP — `POST
> /api/purchase-requests/{requestId}/approvers/{email}/recover`, scoped to a
> LOCKED approver ONLY (an innocent pending approver's OTP is never re-issued).
> Adds `ApproverView.locked` + a requester "Locked" badge and "Re-send OTP"
> button for locked approvers. See the PR #11 section below.

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
| `EVIDENCE_STORE` | `memory` | Local only: the Download PDF flow uses an in-memory store, no AWS needed. Remove it before deploy → S3. |
| `APPROVER_BASE_URL` | `http://localhost:3000` | Mailed approval links open the host at :3000, which composes the approver remote at `/approve`. |
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

> **Quick start**: `pnpm -C backend run db:seed` registers the 4 demo users
> (Ruth requester + Ana/Sven/Luca approvers) directly in DynamoDB — idempotent,
> no curl needed. The curls below remain the manual alternative.

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

# 0b. One user's inbox — the same log restricted to one recipient (newest-first
#     preserved). The host approver console (/demo) uses this per-approver view
#     to resolve each approver's real approval link.
curl -s -w "\nHTTP:%{http_code}\n" "http://localhost:4000/dev/mock-mail?to=ana@example.com"

# 0c. Malformed recipient -> 400
curl -s -w "\nHTTP:%{http_code}\n" "http://localhost:4000/dev/mock-mail?to=not-an-email"

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

**Expected result**: `200 inbox → 200 filtered (?to=) → 400 (bad ?to) → 201 request → 201 issue → 201 validate → 401 (wrong) → 403 (after 3 fails) → 201/403 regenerate`. The OTP is single-use: validating the same code twice returns 410 on the second. A locked approver is rejected with 403 even with the correct code.

> **Routes/status codes** may vary by one letter if the handler differs from this guide's shape —
> the authoritative table is `openspec/changes/purchase-approval-flow/design-api.md`. If a curl
> doesn't match, first confirm the exact path there.

---

### PR #11 — lockout recovery (requester-initiated, LOCKED-ONLY)

A locked approver (3 failed OTP attempts → `tokenStatus=INVALIDATED_LOCKOUT`, so even the
correct code → 403) has NO self-service path. The REQUESTER can recover them via
`POST /api/purchase-requests/{requestId}/approvers/{email}/recover` — which resets ONLY a
LOCKED approver and issues them a FRESH OTP they are mailed. It never touches an innocent
pending approver (their OTP only changes via their OWN issue/regenerate flow, → 409).

```bash
# 1. (optional) Verify the approver is locked via the request detail: ApproverView.locked
curl -s http://localhost:4000/dev/api/purchase-requests/ID

# 2. Recover the LOCKED approver → 201 {expiresInSeconds:180}
#    (bob locked himself by 3 wrong codes in PR #3 step 4)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/purchase-requests/ID/approvers/bob@example.com/recover \
  -H "Content-Type: application/json"

# 3. Validate the NEW code (grab it from /mock-mail) → 200 {valid:true} — the recovered
#    approver is ACTIVE again and their fresh code works end-to-end
curl -s -X POST http://localhost:4000/dev/api/approvals/ID/token/TOKEN/otp/validate \
  -H "Content-Type: application/json" -d '{"email":"bob@example.com","code":"NEW_CODE"}'
```

**409-when-not-locked (the LOCKED-ONLY rule)**: recovering a NON-locked approver (e.g. a
`PENDING`/`ACTIVE` one who never locked) returns **409 `ApproverNotLockedError`** and issues
NO OTP / NO mail — their code is never changed by someone else's action:

```bash
# carol is NOT locked → 409 (locked-only: her OTP is never re-issued by an action she
# doesn't control)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/purchase-requests/ID/approvers/carol@example.com/recover \
  -H "Content-Type: application/json"
```

**Other codes**: unknown request or approver-not-in-request → `404`; terminal request
(`COMPLETED`/`REJECTED`) → `410` (no recovery on a finished request). The requester UI shows
a distinct **Locked** badge + **Re-send OTP** button ONLY for locked approvers; pending
non-locked approvers show PENDING with no resend; terminal requests offer no recovery.

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

> **Local note (demo-fixes, PR #9)**: locally the evidence store is IN-MEMORY
> (`EVIDENCE_STORE=memory` in `backend/.env.example`) — Download PDF works without
> AWS credentials; the bytes live for the backend process lifetime. Deploy keeps the
> variable REMOVED so the S3 adapter is used (see README 8.3 pre-deploy cleanup).

---

### PR #6 — requester panel (frontend)

The host (shell on `:3000`) composes the requester remote (on `:3001`) at `/requester*`
via webpack Module Federation. With the backend running (`pnpm -C backend run dev`,
DynamoDB up), run all three dev servers:

```bash
pnpm run dev:front    # host :3000, requester :3001, approver :3002 (root package.json)
```

> **COMPOSITION SMOKE CHECK (CRITICAL — fresh-review FIX 1)**: the requester's global
> stylesheet must ship through the Module Federation EXPOSED module graph (`App.jsx`,
> which imports `./globals.css`). The remote's `index.js`/CSS NEVER load when the host
> composes it — only the exposed App graph does. Jest suites stay green even if this
> regresses (standalone dev on `:3001` loads its own CSS and masks the bug), so ALWAYS
> verify the COMPOSED app:
>
> 1. Open **http://localhost:3000/requester** in the browser.
> 2. Confirm the UI is STYLED, not raw browser chrome: the page shows the shell nav,
>    a bordered white **card** with the "Purchase requests" title, a styled **New request**
>    button, and — once data exists — a bordered **table** with styled status badges.
>    Raw unstyled buttons/inputs = the CSS graph regression is back.
> 3. Navigate to `/requester/new` (via the button): the create form card renders with
>    styled selectors (dropdowns open with rounded list items).
> 4. Seed data first if the list is empty (PR #2 curls: register users, create a request)
>    so the table has rows to inspect.

Manual UI walk (needs seeded users + requests from the backend curls):

| Step | Action | Expected |
|------|--------|----------|
| 1 | `GET http://localhost:4000/dev/api/users` (register Carol + 3 approvers first) | requester/approver selectors list them |
| 2 | `/requester/new`: fill title/description/amount, pick requester + 3 distinct approvers, submit | navigates to the detail screen of the created request |
| 3 | Detail screen | metadata card + 3-approver table (PENDING/SIGNED/REJECTED badges) |
| 4 | Complete the request via the approver flow (PR #3/#4 curls + `/mock-mail`) | status flips to COMPLETED; **Download PDF** button appears; click downloads `evidence-<id>.pdf` |
| 5 | Enter `1.234` as amount on `/requester/new`, submit | client-side error "Amount can have at most 2 decimal places" (mirrors backend rule) |
| 6 | Leave amount empty, submit | "Amount is required" (NOT "greater than 0") |

**Expected result**: composed UI is fully styled (step 1 of the smoke check is the
critical one — it exercises the exposed-module CSS path that Jest cannot).

---

### PR #7 — approver flow (composed UI, the gate → OTP → decision walk)

The approver remote (on `:3002`) owns `/approve`, composed by the host at
`/approve*`. The flow is driven by the backend's error→HTTP codes, so the smoke
below exercises the real gate (410/403/404/409) through the browser.

> **APPROVER_BASE_URL (CRITICAL for this smoke)**: approval links are built from
> `APPROVER_BASE_URL` in `backend/.env` — it must be the **frontend origin**
> (`http://localhost:3000`), NOT the default backend `http://localhost:4000`,
> or the mailed link opens the raw API URL instead of the composed approver UI.
> Restart the backend after changing it.

**Composition smoke (run first — the CSS-graph invariant, approver flavor):**

1. With the backend + all three frontends running (`pnpm run dev`), create a
   request (PR #2 curls or `/requester/new`) so mock-mail has approval links.
2. Open **http://localhost:4000/dev/mock-mail** — the demo inbox (backend JSON,
   not a frontend page). Copy the `link` of one APPROVAL_LINK mail; replace the
   host part with `http://localhost:3000` (or ensure `APPROVER_BASE_URL` already
   set it).
3. Open that URL in the browser. Expected: a **STYLED** approval screen (card +
   OTP input with "Expires in 3 minutes" style copy) — not raw unstyled
   chrome. Raw styling = the exposed-module CSS graph regressed (same invariant
   as the PR #6 smoke, now for the approver graph).
4. Enter a **wrong** 6-digit code: expect "Incorrect code. N attempts
   remaining." 3 wrong codes → **"Access Locked"** screen with no actions.
   (Do this on a spare link, or regenerate after locking.)

**Happy path walk (one approver):**

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open a fresh approval link (host origin) | OTP entry card, styled, expiry shown |
| 2 | Enter the correct code from `/mock-mail` (`otpPlain`) | Decision screen: request title/amount/requester + "Your decision" card |
| 3 | Click **Approve** | Confirmation: request approved; status flips; **no name input anywhere** |
| 4 | Reopen the same link | Terminal screen "already signed" — informational, **no buttons** (R4) |
| 5 | On a NEW approver link, click **Reject** → inline confirm → **Yes, reject** | Request rejected; `{confirm:true}` sent only after confirm |
| 6 | Reopen another link on the rejected request | Terminal screen "already rejected" — informational, no buttons |

**Terminal-gate checks via curl (the classifier contract, pinned in tests):**

```bash
# Already-signed token → 409 already-acted (approver-flow R1)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/otp \
  -H "Content-Type: application/json" -d '{}'

# Completed request → 410 terminal (COMPLETED message)
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  http://localhost:4000/dev/api/approvals/ID/token/TOKEN/approve \
  -H "Content-Type: application/json" -d '{}'
```

---

### PR #8 — final end-to-end checklist (release & docs)

The complete demo in one pass — register → create → mock-mail → OTP → 3 approvals
→ COMPLETED + PDF. Uses the composed UI; the API curls stay the ground truth.

| # | Step | Where | Expected |
|---|------|-------|----------|
| 1 | Register 1 requester + 3 approvers | PR #1 curls or the create form's user selectors | 201 each / users listed |
| 2 | Create a request (3 distinct approvers) | `/requester/new` or PR #2 curl | 201 `PENDING`; detail shows 3 PENDING rows |
| 3 | Open the inbox (backend JSON) | `http://localhost:4000/dev/mock-mail` | APPROVAL_LINK + OTP mails, newest first |
| 4 | Approver A: open link (frontend origin) → OTP → approve | Browser | SIGNED row in detail |
| 5 | Approver B: same flow | Browser | 2 SIGNED / 1 PENDING |
| 6 | Approver C: same flow — the 3rd approval completes | Browser | status **COMPLETED** |
| 7 | Download PDF | `/requester/<id>` → **Download PDF** | `evidence-<id>.pdf`, real PDF (title, amount, Requester, 3 signature rows) |
| 8 | Reopen any approval link | Browser | terminal "already signed"/"already completed" — no actions |

**Reject variant**: replace step 4 with **Reject → Yes, reject** — the request
goes `REJECTED`, every other link shows the informational terminal screen, and
no PDF appears (download → 404).

**Deploy-only checks** (when run against a deployed API, PR #8 docs):
- `curl .../dev/health` → `{"status":"ok"}`
- Evidence PDF downloads as **real binary bytes** (`file evidence.pdf` → "PDF
  document") — proves `apiGateway.binaryMediaTypes` works; offline cannot.
- Approval links open the composed approver UI on the **CloudFront origin**
  (`APPROVER_BASE_URL` set to it in the deployed backend).

### Demo scenarios script (db:seed-scenarios)

`pnpm -C backend run db:seed-scenarios` drives the RUNNING backend API
(`http://localhost:4000/dev`) to build ready-made demo states. Run it AFTER
`pnpm -C backend run dev` (a second terminal), with the table + demo cast
seeded (`pnpm run demo:setup`). The script logs every step ("Created request …
(PENDING)", "Issued OTP for ana@example.com", "Validated OTP",
"Approved — 2/3 signed", "REJECTED ✓", "COMPLETED ✓"…).

Each run creates a **NEW set of requests** — nothing is cleaned up, the demo
grows (existing data is untouched).

| Seeded request | Status | How to verify |
|----------------|--------|---------------|
| Rejected demo | `REJECTED` | open any of its approval links → the gate shows the terminal screen (410, nothing to act on) |
| Completed demo | `COMPLETED` | detail shows COMPLETED; `GET /api/purchase-requests/<id>/evidence.pdf` → **200 real PDF** (`file` → "PDF document") thanks to `EVIDENCE_STORE=memory` |
| Pending demo (OTP regenerated) | `PENDING` | Ana has **2 OTP mails** in mock-mail — use the LATEST code (only the newest is stored; an older one returns 401). The OTP expires after 180s: once expired, open the link and choose "Generate new OTP" |
| Pending demo (fresh) | `PENDING` | drive the full happy path yourself: open a link → OTP → approve ×3 → COMPLETED + PDF |

### Offline PDF round-trip check (`test:offline-pdf`)

The local evidence flow has a subtle failure mode: serverless-offline runs each
Lambda function in its own worker-thread module scope by default, so the
approval handler puts the PDF into one in-memory store and the download handler
reads an empty one — downloads 404 even though generation succeeded. `pnpm run
dev` therefore starts `serverless offline --useInProcess` (all handlers in one
process, sharing the store), and this check proves it end-to-end:

```bash
pnpm -C backend run db:up            # dynamodb-local (Docker), if not already up
pnpm -C backend run db:create-table  # purchase-approvals-dev (idempotent)
pnpm -C backend run test:offline-pdf # boots ITS OWN offline server on :4000
```

`verify-local-pdf.mjs` spawns `serverless offline --useInProcess`, waits for
`:4000` health, drives the full happy path through the API (create → issue OTP
→ read code from mock-mail → validate → approve ×3 → COMPLETED), downloads
`/evidence.pdf` and asserts **200 + `application/pdf` + non-empty `%PDF`
bytes**, prints `PASS`/`FAIL`, then kills the server it started. Needs `:4000`
free (stop any running `pnpm run dev` first). Exit 0 on success, 1 on failure.

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
- [ ] PR #6 composition smoke: `http://localhost:3000/requester` renders STYLED (nav, card, table, styled buttons) — exposed-module CSS graph works
- [ ] PR #6 create form: 3 distinct approvers → detail; amount `1.234` → client error; empty amount → "Amount is required"
- [ ] PR #7 composition smoke: an approval link from `/mock-mail` (host origin) renders the STYLED approver UI; wrong OTP ×3 → "Access Locked" with no actions
- [ ] PR #7 approve: no name input; reopen link → "already signed" terminal with no buttons; reject requires inline confirm (`{confirm:true}`)
- [ ] PR #8 final flow: register → create → mock-mail → OTP → 3 approvals → **COMPLETED** → Download PDF (real PDF bytes)
- [ ] PR #8 reject variant: first reject wins → `REJECTED`, other links informational, PDF download 404
- [ ] PR #8 deploy notes present in root README (backend `sls deploy` + frontend S3/CloudFront, `APPROVER_BASE_URL` documented)