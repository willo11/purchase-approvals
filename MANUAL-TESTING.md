# Manual Testing — Purchase Approvals

Guide to exercising the system by API with `curl`, without spinning up AWS. Everything
runs locally (DynamoDB in Docker + `serverless offline` on `:4000`). It is updated as
PRs land.

> Current status: **PR #1 — user-registry (backend API)**. The frontend is NOT yet
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

### PR #X — (pending)

The curls for the coming PRs will be added here as they land (purchase-request,
approver-otp, approval-signature, pdf-evidence, requester-panel, approver-flow).

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

## Checklist

- [ ] `backend/.env` created from `.env.example`
- [ ] `dynamodb-local` running (`db:up`) and `purchase-approvals-dev` table created
- [ ] `pnpm -C backend run dev` responds on `:4000`
- [ ] The 5 PR #1 curls return `201 → 409 → 400 → 400 → 200`