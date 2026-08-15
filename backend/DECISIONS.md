# Backend — Decision Log (Tradeoffs)

> Study material for the technical interview. Each entry captures a real tradeoff
> discussed during development: the question, the options, what we chose, why,
> and what to say when defending it.
> New entries get appended as decisions are made.

---

## 1. Serverless (AWS Lambda) vs traditional always-on backend
- **Tradeoff**: rent a running server (EC2/container, pay even when idle, manage scaling/patches) vs functions that run on demand (pay per execution, auto-scale, no infra management).
- **Decision**: Serverless — Lambda + API Gateway + DynamoDB + S3.
- **Why**: the assignment requires it; the flow is event-driven (create → notify → OTP → sign → generate PDF); free tier keeps the take-home at ~$0; managed services remove ops.
- **Costs**: cold starts on first request, stateless (all state must live in external stores), 15-min Lambda timeout, harder local debugging.
- **Interview line**: "The flow is naturally event-driven, so serverless fits the domain. State lives in DynamoDB; Lambdas are stateless by design, which forces correct data modeling."

## 2. DynamoDB single-table (query-first) vs relational modeling
- **Tradeoff**: SQL normalizes data and joins at query time; DynamoDB has NO joins and rewards denormalization.
- **Decision**: Single-table with prefixed keys: `USER#<email>`, `REQ#<id>`, `REQ#<id>/APPR#<email>`.
- **Why**: one call fetches a request and its approvers; each access pattern (list by requester, fetch detail, approve) resolves in a single read.
- **Rule**: design the QUERIES first, then the data shape — the opposite of SQL-first thinking.
- **Interview line**: "I modeled the data around the access patterns: every query is a single-table read. In SQL I would have normalized; in DynamoDB the rule is query-first."

## 3. Denormalization / snapshots
- **Tradeoff**: repeating data (snapshots) vs normalizing references and paying N+1 reads.
- **Decision**: purchase stores `createdBy: {email, name}` and each approver `{email, name}` as a snapshot; signatures store the user's registered name.
- **Why**: no joins in DynamoDB; historical evidence (PDF) must not break if a user changes name/position later.
- **Interview line**: "Snapshots are deliberate: evidence must be immutable even if identity data changes. That's the NoSQL tradeoff — duplicated data for query speed and integrity."

## 4. DynamoDB TTL for OTP expiry
- **Tradeoff**: implementing expiry in application code (a cleanup job) vs native auto-delete.
- **Decision (CORRECTED at design time)**: the OTP lives in its OWN TTL item (`OTP#<reqId>#<email>`, 3-min TTL), NOT inside the approver row.
  - Earlier lean put the OTP inside the approver item with TTL — WRONG: mapping table TTL to the durable approver record would DELETE the approver (with its signature/status) when the OTP expires. Thinking of it, that would lose evidence. The dedicated TTL item fixes it.
- **Why**: DynamoDB deletes the OTP item automatically — no cron/job needed — while the durable approver record (token, status, signature) survives.
- **Caution**: TTL is asynchronous cleanup, NOT the only expiry gate — expiry is ALSO validated in code against `otpExpiresAt` to avoid accepting an expired OTP before TTL fires.
- **Interview note**: this "which item owns the TTL" decision is a classic NoSQL trap — mention that you keep TTL off the durable record to preserve audit data.

## 5. Serverless Framework vs SAM vs CDK
- **Tradeoff**: DX and local dev vs AWS-native vs code-first power.
- **Decision**: Serverless Framework (`serverless.yml`).
- **Why**: `serverless-offline` gives local dev with the same URLs as production (no docker); one-command deploy (`sls deploy`); widest industry adoption for Lambda-centric apps.
- **Costs**: third-party abstraction; occasionally need raw CloudFormation for exotic resources.
- **Alternatives**: SAM = AWS-native but slower local DX; CDK = testable infrastructure in TypeScript but heavier curve — worth mentioning as the "power" option in the interview.

## 6. Plain Lambdas vs Step Functions
- **Tradeoff**: simplicity vs orchestration/retry/visibility for multi-step flows.
- **Decision**: Plain Lambda handlers per endpoint; one function per use case.
- **Why**: the flow fits in a few handlers; the "3rd signature → generate PDF → COMPLETED" step is a condition inside the sign handler; SFN would add deploy complexity for a take-home.
- **Documented evolution**: a Step Functions state machine could wrap the completion flow for retries and observability.

## 7. PDF library: pdf-lib vs pdfmake vs pdfkit
- **Tradeoff**: Lambda compatibility (no native deps), bundle size, table rendering ease.
- **Decision**: pdf-lib (pure TypeScript, zero native dependencies).
- **Why**: safe inside Lambda (no native binaries), small footprint; the signature table is drawn explicitly (3 slots).
- **Interview line**: "Native deps are a real risk inside Lambda runtimes — pdf-lib avoids them entirely."

## 8. Clean Architecture layers (domain / application / infrastructure / api)
- **Tradeoff**: layered purity vs simpler feature-folders.
- **Decision**: layers — `domain/` (entities, value objects, enums, zero framework deps), `application/` (use cases + ports), `infrastructure/` (DynamoDB, mail, PDF, S3 adapters), `api/` (Lambda handlers, DTOs, validation).
- **Why**: separation of responsibilities (explicit requirement), test the heart of the flow without AWS; handlers are thin adapters.
- **Interview line**: "The domain has no idea AWS exists. Every framework/cloud concern is an adapter behind a port — that's what makes the core unit-testable."

## 9. User model: employees, position as role, email as key
- **Tradeoff**: interpreting the assignment's "three distinct roles" as persons vs abstract roles.
- **Decision**: `User` entity = company employee (`name`, `email` PK, `position`). Within a purchase, role is POSITIONAL: `createdBy` = requester, `approvers[3]` = approvers.
- **Why**: a personal signature needs a real identity; "roles" in the purchase are derived from structure, not stored.
- **Interview line**: "The role is not a field on the purchase — it's derived from where the user is referenced (requester vs approver). The position field on the employee gives the three distinct roles the brief asks for."

## 10. Email-only identity + auth disclaimer
- **Tradeoff**: real authentication (Cognito/JWT) vs minimal demo identity.
- **Decision**: email-only identity selection (no password) for the demo; documented limitation.
- **Why**: scope control; the real access gate is the unique link + OTP; keeps the take-home deliverable.
- **Interview line**: "Auth is explicitly out of scope for this demo — identity is by email. Production would use Cognito or JWT; it's documented as a future improvement, not an oversight."

## 11. Mock mail vs real SMTP
- **Tradeoff**: configuring SMTP (credentials, deliverability) vs simulating delivery.
- **Decision**: mail events table + `GET /mock-mail` endpoint exposing sent links/OTPs for demo/QA.
- **Why**: the assignment allows simulation; the endpoint lets the reviewer drive the whole flow without a mail server.

## 12. Deploy: backend to AWS, frontend to S3 + CloudFront
- **Tradeoff**: one platform for everything vs splitting static assets to a CDN.
- **Decision**: backend → AWS (Lambda + API Gateway + DynamoDB + S3) via Serverless Framework; frontend static build → S3 bucket + CloudFront.
- **Why**: Serverless Framework provisions AWS resources only — it cannot deploy to Vercel. The frontend is static files, so any static host works; S3+CloudFront keeps the whole story on AWS. Vercel/Netlify remain valid simpler alternatives for the frontend.

## 13. Concurrency: single CAS lock on the REQUEST item
- **Tradeoff**: naive read-then-write can double-complete or let approve-vs-reject race; needs atomicity across two Lambdas.
- **Decision**: the REQUEST item is the concurrency owner. Every global transition `PENDING → COMPLETED|REJECTED` is a conditional `UpdateItem` (compare-and-swap): complete gated by `attribute_not_exists(completedAt)`, reject by `status = PENDING AND attribute_not_exists(rejectedAt)`. PDF generation is idempotent via an existence key (`attribute_not_exists(evidenceKey)`) and a deterministic S3 key. DynamoDB serializes conditional writes on a single item, so exactly one outcome wins.
- **Why**: no distributed lock needed — DynamoDB CAS gives atomic transition for free; guarantees COMPLETED/REJECTED fire at most once even with concurrent signatures.
- **Interview note**: "The request item is the lock. Conditional expressions make approve-vs-reject atomic — I never read-then-write without a compare-and-swap guard."

## 14. OTP design
- **Tradeoff**: plain vs hashed storage; unlimited vs bounded retries.
- **Decision**: 6-digit numeric OTP, stored SHA-256 hashed, unique per approver, valid 3 minutes; 3 failed attempts invalidate the token; expired OTP → "generate new OTP" (simulated resend).
- **Why**: defense in depth (hashed at rest), bounded brute force, honest expiry semantics in code + TTL.

## 15. Package manager: pnpm (v11) + the allowBuilds gotcha
- **Decision**: pnpm for all packages; monorepo stays independent folders (no workspace tool).
- **Why**: faster installs, strict dependency layout (symlinked store), no npm lockfiles.
- **Gotcha (pv11)**: pnpm ignores dependency build scripts by default and **fails with exit 1 (ERR_PNPM_IGNORED_BUILDS)** until you allow them. The setting lives in `pnpm-workspace.yaml` (`allowBuilds:` map), NOT in package.json — that is a v11 breaking change. Backend needed `allowBuilds: { serverless: true, aws-sdk: true, es5-ext: true }`.
- **Interview line**: "pnpm v11 gates postinstall scripts by default; I allowed only the ones that need to build (Serverless Framework) in pnpm-workspace.yaml."

## 16. User registry: email as PK, optional position with default, no-password
- **Tradeoff**: what identifies a user unambiguously; whether job position is required; how much auth to ship for the demo.
- **Decision**: `email` is the natural key (`USER#<email>`); `position` is optional and defaults to `Employee`; no password is accepted or stored.
- **Why**: email is inherently unique and re-verified by `Email` format validation; the brief lists three roles but they are positional (Decision 9), so `position` needs no required enum — a default keeps the payload ergonomic; email-only identity (Decision 10) keeps the demo deliverable and documents auth as out of scope.
- **Duplicate prevention**: enforced by the database, not application memory — the repository `PutItem` uses `ConditionExpression: attribute_not_exists(PK)`, so a concurrent or double registration maps to 409 with zero chance of overwrite.
- **Interview line**: "The natural key is the email and the uniqueness constraint lives in a conditional PutItem — I never read-then-write to check for duplicates; DynamoDB does that atomically."

---

## 17. Design patterns in the implementation (Clean Code reference — pre-interview)

> Compact map of the patterns actually used in the user-registry PR, with the one-liner
> to defend each. These are not studied abstractions: each one is alive in the code.

| Pattern | Role in the code | File | Interview one-liner |
|---------|------------------|------|--------------------|
| **Repository (port)** | Abstracts data access: the use case talks to an interface, not to DynamoDB | `application/ports/UserRepository.ts` | "The use case depends on a contract (port), not on DynamoDB — the storage engine is swappable." |
| **Adapter** | Translates the contract to the real external world; the only layer that knows `@aws-sdk` | `infrastructure/DynamoDbUserRepository.ts` | "The adapter is the translator: the domain speaks its own language, only the adapter speaks DynamoDB." |
| **Ports & Adapters / Hexagonal** | The domain at the center (pure logic), the adapters outside for infrastructure | layering global (domain/application/infrastructure/api) | "The hexagon is the domain; I can swap the database without the core noticing." |
| **Entity** | Object with its own identity, identified by its email | `domain/User.ts` | "A User is identified by its identity (its email), not by its attributes." |
| **Value Object** | Immutable object that validates itself and compares by value; normalizes `ANA@` → `ana@` | `domain/values/Email.ts` | "Email is a value object: it carries its own validation and normalization, so an invalid format can't exist." |
| **Application Service / Use Case** | Orchestrates ONE business task without knowing "how" | `application/RegisterUser.ts` | "The use case holds the business rule (duplicate→409) and ignores the technology (DynamoDB)." |
| **Factory (composition root)** | Builds the adapter and its dependencies | `makeUserRepository()` | "makeUserRepository is the composition root — the only place that wires the adapter from the environment." |
| **Dependency Injection** | The handler receives the already-built adapter | `constructor(private readonly env)` | "Dependencies are injected, not imported — that's what lets tests swap a fake repository." |
| **Mapper (error → HTTP)** | Translates typed domain errors to HTTP codes declaratively | handler `userRegistry.ts` + `design-api.md` table | "The handler is a thin error→HTTP mapper; it never embeds business rules or status-code if/else." |

**The phrase that carries the whole argument** — why layers at all:

> "The core changes when the BUSINESS changes; the adapter changes when the PROVIDER
> changes (DynamoDB); the handler changes when the HTTP CONTRACT changes. If I mixed all
> three, any change would force me to touch storage + business + HTTP at once. Separated,
> each layer is unit-testable on its own."

**Proof this runs in practice** (say this if asked "how do you know it works?"):
- Unit tests inject a **fake repository** (same port) to test the use case with no AWS.
- Integration tests inject the **real DynamoDB adapter** for an end-to-end round-trip.
- Same use case, two storage backends, zero changes to the domain — that's the pattern earning its keep.

---

## 18. The purchase request aggregate: positional role + naive name snapshot
- **Tradeoff**: how much state and business rule to hold in the `PurchaseRequest` entity vs scattering validation across the use case and handlers; and whether to store denormalized names or only email references.
- **Decision**: `PurchaseRequest` is the aggregate. It OWNS creation invariants (R1): non-empty title/description, positive amount with ≤2 decimals, exactly 3 approver emails, distinct from one another and from the requester. `GlobalStatus` (`PENDING | COMPLETED | REJECTED`) dominates all gates with precedence `COMPLETED > REJECTED > PENDING` (R2). Roles are POSITIONAL (requester/approver derived from where a user is referenced — see Decision 9). Names are SNAPSHOTTED at creation: `createdBy: {email, name}` and each approver `{email, name}` (Decision 3).
- **Why**: the aggregate gives one place where a request's invariants are guaranteed before anything touches the outside world — the handler stays a thin error→HTTP mapper. Role is positional because a personal signature needs the real registered identity, not a stored role label. Snapshotting makes evidence immutable: a later name/position change to a registered user never corrupts an existing request's PDF (the exact tradeoff spelled out in Decision 3).
- **Costs**: denormalization duplicates names across request rows (accepted NoSQL cost); a request whose approver is later removed from the registry still carries the old snapshot — which is the point. The `approvers` snapshot array on the REQ row and the 3 separate `APPR#<email>` rows both hold names today; the separate rows are the durable status/token records, the array is the quick evidence read.
- **Interview line**: "The request is the aggregate: it enforces its own invariants at creation, so the handler never embeds business rules. Role is derived from where a user is referenced, not stored on the purchase — and names are a deliberate snapshot so the PDF evidence can't break when identity data changes."
- **Note (registry 404 vs 400)**: unknown requester/approver emails surface as `UnknownUserError` → HTTP 404 per the design-api policy. The delta spec's R1 "Unknown approver email" scenario literally reads 400; the design/API contract (and this PR's instructions) authoritatively chose 404 for "unknown registry emails". Flagged so the reviewer can confirm the intended code before merge.

---

## 19. OTP access gate: dedicated TTL item, in-code expiry, atomic lockout
- **Tradeoff (a) — where the OTP lives**: a real tradeoff between mapping table TTL to the durable approver row vs giving the OTP its own item.
  - **Decision**: the OTP lives in its OWN TTL item (`OTP#<reqId>#<email>`, PK/SK both `OTP#<reqId>#<email>`) with the table TTL attribute `otpExpiresAt` set to the 3-minute in-code expiry. The DURABLE approver record (`APPR#<email>`) never carries a TTL.
  - **Why**: mapping TTL to the approver row would let DynamoDB DELETE the approver (token, status, attempts) when the OTP expires — losing signature/approval evidence. The dedicated TTL item dies, the approver survives.
  - **Interview line**: "The classic NoSQL trap is which item owns the TTL. I keep TTL off the durable approver record so auto-expiry can never delete approval state; the OTP row is disposable, the approver is permanent."
- **Tradeoff (b) — expiry mechanism**: native TTL auto-delete vs honoring expiry in code.
  - **Decision**: expiry is validated IN CODE against `otpExpiresAt` on every validation BEFORE any code comparison (spec R4). DynamoDB TTL is asynchronous CLEANUP only, never the expiry gate.
  - **Why**: TTL deletion can lag minutes; without an in-code check an expired OTP whose row still exists would remain usable. Checking `stored.otpExpiresAt <= now` first guarantees expired means expired.
  - **Interview line**: "Expiry is enforced in code against the stored timestamp; TTL just sweeps the debris. A TTL that hasn't fired yet can never resurrect an expired OTP."
- **Tradeoff (c) — 3-strike lockout atomicity**: naive read-then-increment can overshoot or race.
  - **Decision**: the failed-attempt counter and the lockout flag BOTH live on the durable approver item. A failed validation issues a conditional `UpdateItem` (`tokenStatus = ACTIVE AND attempts < 3 AND no signature present`) doing `SET attempts = attempts + 1`. When the returned `attempts` reaches 3, the SAME winning path durably sets `tokenStatus = INVALIDATED_LOCKOUT` (conditional, idempotent).
  - **Why**: the `attempts < 3` condition is a compare-and-swap DynamoDB serializes — concurrent wrong submissions can never push the counter past 3, and only the write that reaches the limit triggers lockout. `INVALIDATED_LOCKOUT` blocks validate AND regenerate (R5/R6) at the gate, so even the correct code is rejected after the 3rd failure (R5).
  - **Costs / nuance**: **hardened by independent review** — the counter increment and the lockout are now folded into a SINGLE atomic update: `UpdateExpression: SET attempts = attempts + :one, tokenStatus = :locked` with `ConditionExpression: tokenStatus = :active AND attempts = :limitMinusOne`. So the counter never reaches 3 while `ACTIVE` and the third failure sets `INVALIDATED_LOCKOUT` in the SAME write — no microsecond window, no overshoot. Concurrency tests against dynamodb-local prove 5 parallel wrong submits land on exactly `attempts==3` + lockout. The OTP digest is SHA-256 of `code + context` — the plaintext code is never stored or compared.
  - **Interview line**: "I used a conditional UpdateItem as the counter CAS: DynamoDB serializes it, so three concurrent wrong submissions yield exactly three attempts and the third sets `INVALIDATED_LOCKOUT` atomically at the boundary. TTL is the OTP item's cleanup; the lockout lives on the permanent approver row."

---

## 20. CAS vs idempotency key — and the atomic one-time OTP consume
- **Tradeoff**: how to stop two concurrent calls from double-applying. Two different tools exist, and people confuse them. Class 1 (the same client retries the SAME logical operation after a timeout) → client-supplied **idempotency key**. Class 2 (two INDEPENDENT actors hit the same resource at the same instant) → **DB-level compare-and-swap**. The OTP consume and the lockout are Class 2.
- **Decision (a) — OTP consume is an atomic CAS, not an idempotency key**: the "consume OTP once" guarantee (spec R4) is enforced at the data layer with a **conditional delete**: `DeleteItem WHERE otpHash = :submittedHash AND otpExpiresAt > :now`. Exactly ONE concurrent submission of the correct code wins the delete; the loser hits `ConditionalCheckFailed` and is treated as already-consumed (410). Two tabs / two devices / a script cannot share an idempotency key, so the guard must not depend on the caller — the DB CAS makes single-use true regardless of who races.
  - **Do NOT add an idempotency key here**: it would require the racing actors to cooperate with a shared key (they can't), and the lockout counter must NOT be deduplicated anyway (each failure must count). Idempotency and CAS solve different classes — using the wrong one is the failure mode.
- **Decision (b) — where idempotency keys WOULD belong** (future, not added now): on `issue OTP` and on `create request`/`approve` as a client-retry layer to avoid duplicate mails/transitions — always COMPLEMENTARY to the DB CAS, never replacing it. The DB CAS decides the single winner of a write; the key dedupes the client seeing two successes.
- **The one-liner that carries both**:
  > "Idempotency key = dedupe of retries from the SAME actor (needs the client to cooperate). CAS/conditional write = single winner among actors that can't coordinate (the database guarantees it). Both classes exist; the OTP consume and lockout are concurrency class, so the guard lives in a conditional write, not in a header."

---

## 21. Mock mail is an outbox — why swapping to SES is trivial
- **Tradeoff**: the assignment allows simulating email; real SES (or SMTP) needs credentials, verify identities, deliverability. But the design should not paint us into a corner.
- **Decision**: `MockMailRepo` implements `MailPort` and writes a `MAIL` row per event (approval-link and OTP) into the single table; `GET /mock-mail` lists the "inbox" newest-first. `MailPort.send(event: MailEvent)` is the only contract the use cases see.
- **Why this is really an outbox, not just a hack**: the DB-backed mock **IS the outbox pattern**. Today a human reads the table via `/mock-mail`; tomorrow a worker drains that same table into SES — **no change to the domain or the use cases**. The swap is a different ADAPTER (`SesMailAdapter implements MailPort` → `ses.sendEmail(...)`) injected at the composition root, or an outbox consumer. Three worlds share one contract: unit tests inject `FakeMailPort`, the demo injects `MockMailRepo`, release injects `SesMailAdapter`.
- **Interview line**: "The simulated mail is a real outbox: I write a mail event per dispatch and an endpoint reveals it. Integrating SES later is a one-file adapter behind the `MailPort` — the use case never knows an email provider exists."

---

## 22. The signature CAS core: single lock on the REQUEST item, implemented (Decision 13 proof)
- **Tradeoff**: naive read-then-write lets two concurrent signatures double-complete a request, or lets an approve and a reject both land. The state that must move exactly once (`PENDING → COMPLETED|REJECTED`) needs an atomic transition across independent Lambda invocations.
- **Decision (the implemented proof of Decision 13)** — every global transition is a conditional `UpdateItem` on the REQUEST item:
  - **Approve — Step A (per-approver idempotency)**: `UpdateItem APPR#<email>` `ConditionExpression: attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)`, `SET status_signed = :now, signature = {name, timestamp}`. The signature name is the REGISTERED snapshot (spec R1) — never typed. One approver can never sign twice (R4); the losing write → 409 already-acted.
  - **Approve — Step B (the completion CAS)**: only when the re-read approver set shows 3 signed, `UpdateItem REQ#<id>` `ConditionExpression: attribute_not_exists(completedAt)`, `SET completedAt = :now, status = COMPLETED`. Exactly ONE writer passes; the loser gets `ConditionalCheckFailedException` → re-reads, returns the current state and **does NOT generate evidence** (R3/R4). Only the CAS winner calls `EvidenceGeneratorPort` (PDF shipped in PR #5).
  - **Reject — Step A**: same condition as approve but `SET status_rejected = :now` on the approver row.
  - **Reject — Step B (first-reject-wins)**: `UpdateItem REQ#<id>` `ConditionExpression: status = PENDING AND attribute_not_exists(rejectedAt)` → global `REJECTED` (R2 terminal). A concurrent approve that already CAS'd `COMPLETED` makes this condition fail → reject loses, request stays `COMPLETED`.
- **Gate 4th check**: `ApproverGate` gained the "already acted" check (signed OR rejected → 409) as the shared eligibility point for OTP and signing use cases — an approver who acted cannot re-enter the OTP flow (approver-flow R1/R4).
- **The nuance that matters in the interview — who actually decides approve-vs-reject**: with exactly 3 approvers, the same person cannot both approve and reject, so the approve-vs-reject race on one approver collapses at Step A (the per-approver CAS: exactly one of `markSigned`/`markRejected` passes). The REQUEST-level CAS is the backstop that (a) makes double-completion impossible (`attribute_not_exists(completedAt)` exclusive) and (b) makes reject lose to an already-`COMPLETED` request. Integration tests race both real writers: two concurrent approves → exactly one `completedAt` + both signatures + one evidence; approve-vs-reject → completed XOR rejected; two completion CAS writers → exactly one wins.
- **Gotcha**: `status` is a DynamoDB RESERVED keyword — the adapter emits `#status` (ExpressionAttributeNames) in both the UpdateExpression AND the reject ConditionExpression. The unit-level fake asserts the DESIGN's logical condition string; the real adapter needs the placeholder syntax.
- **Interview line**: "The REQUEST item is the single lock. I never read-then-write a global transition without a compare-and-swap: completion is gated by `attribute_not_exists(completedAt)`, reject by `status = PENDING AND attribute_not_exists(rejectedAt)`. DynamoDB serializes conditional writes, so exactly one outcome wins — and the loser of a completion race does NOT generate evidence."
