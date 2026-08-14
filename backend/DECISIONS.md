# Backend — Decision Log (Tradeoffs)

> Study material for the technical interview. Each entry captures a real tradeoff
> discussed during development: the question, the options, what we chose, why,
> and what to say when defending it ("sustentar").
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
- **Why**: no joins in DynamoDB; historical evidence (PDF) must not break if a user changes name/cargo later.
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
- **Why**: the flow fits in a few handlers; the "3rd signature → generate PDF → Completada" step is a condition inside the sign handler; SFN would add deploy complexity for a take-home.
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

## 9. User model: employees, cargo as role, email as key
- **Tradeoff**: interpreting the assignment's "three distinct roles" as persons vs abstract roles.
- **Decision**: `User` entity = company employee (`name`, `email` PK, `cargo`). Within a purchase, role is POSITIONAL: `createdBy` = solicitante, `approvers[3]` = aprobadores.
- **Why**: a personal signature needs a real identity; "roles" in the purchase are derived from structure, not stored.
- **Interview line**: "The role is not a field on the purchase — it's derived from where the user is referenced (requester vs approver). The cargo field on the employee gives the three distinct roles the brief asks for."

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
- **Decision**: the REQUEST item is the concurrency owner. Every global transition `Pendiente → Completada|Rechazada` is a conditional `UpdateItem` (compare-and-swap): complete gated by `attribute_not_exists(completedAt)`, reject by `status = Pendiente AND attribute_not_exists(rejectedAt)`. PDF generation is idempotent via an existence key (`attribute_not_exists(evidenceKey)`) and a deterministic S3 key. DynamoDB serializes conditional writes on a single item, so exactly one outcome wins.
- **Why**: no distributed lock needed — DynamoDB CAS gives atomic transition for free; guarantees Completada/Rechazada fire at most once even with concurrent signatures.
- **Interview note**: "The request item is the lock. Conditional expressions make approve-vs-reject atomic — I never read-then-write without a compare-and-swap guard."

## 14. OTP design
- **Tradeoff**: plain vs hashed storage; unlimited vs bounded retries.
- **Decision**: 6-digit numeric OTP, stored SHA-256 hashed, unique per approver, valid 3 minutes; 3 failed attempts invalidate the token; expired OTP → "generate new OTP" (simulated resend).
- **Why**: defense in depth (hashed at rest), bounded brute force, honest expiry semantics in code + TTL.
