# Concurrency & Atomicity Design (Detail)

## 1. Item schema relevant to concurrency

Single table. Partition/sort keys:

| Type | PK | SK | Key fields | TTL |
|---|---|---|---|---|
| USER | `USER#<email>` | `USER#<email>` | name, cargo, createdAt | — |
| REQ | `REQ#<id>` | `REQ#<id>` | title, description, amount, createdBy{email,name}, approvers[{email,name}×3], status (Pendiente|Completada|Rechazada), createdAt, completedAt?, rejectedAt?, rejectedBy? | — |
| APPR | `REQ#<id>` | `APPR#<email>` | email, name, token, tokenStatus (ACTIVE\|INVALIDATED_LOCKOUT), attempts, status_signed?, status_rejected?, signature{name,timestamp}? | — |
| OTP | `OTP#<requestId>#<email>` | `OTP#<requestId>#<email>` | otpHash, otpExpiresAt | yes (3 min) |
| MAIL | `MAIL#<uuid>` | `MAIL#<uuid>` | to, type (APPROVAL_LINK\|OTP), subject, body, link?, otpPlain? , createdAt | — |

Index: `GSI1` — `gsi1pk=TYPE#<typecode>`, `gsi1sk=createdAt` (string ISO) for newest-first listing of REQ and MAIL without a scan.

## 2. Gate chain (checked in fixed order, all on durable items)

1. Read REQ item (single `GetItem`). If `status` is `Completada` or `Rechazada` → **terminal response** (410); no OTP/approve/reject offered.
2. Read APPR item. If `tokenStatus = INVALIDATED_LOCKOUT` → **lockout response** (403).
3. If approver `status_signed`/`status_rejected` present → **already acted** (409/terminal).
4. Else OTP/gate flow proceeds.

Rationale: reading one REQ + one APPR is two single-row reads — no joins. Terminal global state dominates: even a correct OTP cannot act on a terminal request.

## 3. Atomic approve

Two steps, first always commits, second is the exclusive global CAS.

**Step A — approver commit (per-approver idempotency):**
```
UpdateItem:
  Table       : {PK: "REQ#<id>", SK: "APPR#<email>"}
  UpdateExpression: SET status_signed = :now, signature = {name: :n, timestamp: :now}
  ConditionExpression: attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)
  ExpressionAttributes: { ":now": nowIso, ":n": registeredName }
```
Only one write for this approver can pass (no double-sign). If it fails → "already signed/rejected" (409).

**Step B — global completion CAS (the atomic transition):**
```
UpdateItem:
  Table       : {PK: "REQ#<id>", SK: "REQ#<id>"}
  UpdateExpression: SET completedAt = :now, status = :completada, gsi1sk = :now
  ConditionExpression: attribute_not_exists(completedAt)
  ExpressionAttributes: { ":now": nowIso, ":completada": "Completada" }
```
Only ONE of the 3 concurrent approvers can pass `attribute_not_exists(completedAt)`. Then read the approver set (`Query PK=REQ#<id>`) and count `status_signed`; if count == 3 → proceed to PDF. If count < 3, the earlier Completada won't have happened for the 2nd signer — **the completion CAS is reached ONLY when the accumulating approver set already shows 3 signed**. Enforcement:
- Before Step B, the handler counts `status_signed` in the approver set; it only issues the completion CAS when all 3 are signed.
- The CAS `attribute_not_exists(completedAt)` guarantees only one correct (3-signed) writer marks completion, and a stale writer whose set read is incomplete will fail its own CAS read-guard and NOT trigger.
- Actually the binding guarantee: because `attribute_not_exists(completedAt)` is exclusive, only ONE invocation ever sets it. That invocation is the only one that can run PDF generation. Even if two invocations both counted 3, exactly one wins the CAS; the loser gets `ConditionalCheckFailedException` → if `keyConditionFailed`/`conditionalCheck`, handler re-reads, sees `completedAt` present, and does NOT generate PDF (returns the existing state).

**Result**: `Pendiente → Completada` happens at most once; `completedAt` is the idempotency key for PDF (`see §5`).

## 4. Atomic reject

**Step A — approver commit:**
```
UpdateItem {PK:"REQ#<id>", SK:"APPR#<email>"}
  SET status_rejected = :now, signature = {name: :n, timestamp: :now}
  ConditionExpression: attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)
```

**Step B — global reject CAS (only first reject wins):**
```
UpdateItem {PK:"REQ#<id>", SK:"REQ#<id>"}
  SET rejectedAt = :now, rejectedBy = :email, status = :rechazada, gsi1sk = :now
  ConditionExpression: status = :pendiente AND attribute_not_exists(rejectedAt)
  (":rechazada":"Rechazada", ":pendiente":"Pendiente")
```
If a concurrent approve already CAS'd `Completada`, this reject CAS fails (`status != Pendiente`) → the request stays `Completada`, the reject loses. If this reject wins first, a concurrent approve's completion CAS) fails → Completada never lands, reject dominates. **Approve-vs-reject race resolves to exactly one winner because only one REQ-level CAS can pass its precondition at a time** — DynamoDB serializes conditional writes on the same item.

## 5. PDF idempotency

The handler that wins Step B completion CAS continues synchronously:
```
GenerateEvidence(request)         // pdf-lib → Uint8Array
S3.PutObject(Bucket, evidenceKey = "reqs/<id>/evidencia.pdf", Body, ContentType: "application/pdf")
  → then UpdateItem REQ SET evidenceKey = "reqs/<id>/evidencia.pdf", evidenceUrl = ...
```
Guard: before PutObject, handler checks `attribute_not_exists(evidenceKey)` read; after CAS win, only one handler runs this path. PutObject overwrite is safe. If generation/s3 fails, we catch, log, LEAVE status `Completada`, and do NOT set evidenceKey → download returns 404 (spec R4). Evidence URL construction is deterministic (bridge to API Gateway), so no stored state is required for the mapping beyond the key.

## 6. OTP lockout & regenerate (alsatomic)

- Validation fail → `UpdateItem APPR` `ConditionExpression: attempts < :3`, `SET attempts = attempts + 1`. When the field becomes 3 (read the returned NewImage as `ResponseValues: ALL_NEW`), set `tokenStatus=INVALIDATED_LOCKOUT` in the SAME update using `SET tokenStatus = :locked` — one atomic write, no lost update. Condition `attempts < :3` guarantees the counter is not overshot by concurrent wrong submits.
- Regenerate → `UpdateItem APPR` `ConditionExpression: tokenStatus = :active`, `SET attempts = :0`, and `PutItem OTP` with fresh `otpHash`+`otpExpiresAt`. `INVALIDATED_LOCKOUT` blocks regenerate (condition fails).
- OTP validation requires the OTP item to exist AND `otpExpiresAt > now` (in-code expiry); TTL deletion is cleanup only. On a correct code we `DeleteItem OTP` (consume), keeping it single-use.

## 7. Interview talking points

- "DynamoDB `ConditionExpression` on UpdateItem is a compare-and-swap; I used it as the only writer of the global transition so the FSM moves exactly once."
- "The lock (REQ item) is the smallest thing that must be exclusive — completeness of the decision, not every row."
- "Reads are single-row; the only consistency burden is the one CAS, which the DB serializes."
- "PDF idempotency uses an existence key, so a redelivered/double execution cannot double-generate."
- "The TTL-object vs row-field choice (OTP as its own item) avoids DynamoDB deleting durable approver records."