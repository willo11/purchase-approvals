# Demo — live deployment (current links)

Everything is deployed to AWS. This doc has the links to run the demo end-to-end and
the credentials to seed it. Replace nothing — these are the current values.

---

## Access links (current)

### Frontend (micro-frontends)

| App | URL |
|-----|-----|
| **Host** (open this) | `https://d2w6pt5r1wzlum.cloudfront.net` |
| Requester panel | `https://d2w6pt5r1wzlum.cloudfront.net/requester` |
| Approver console (demo) | `https://d2w6pt5r1wzlum.cloudfront.net/demo` |
| Requester remote (direct) | `https://dvh7hrbuiupoy.cloudfront.net` |
| Approver remote (direct) | `https://dc9klktisn7nb.cloudfront.net` |

### Backend (API Gateway)

| Resource | URL |
|----------|-----|
| API base | `https://whlw0bdtn6.execute-api.us-east-1.amazonaws.com/dev` |
| **Demo inbox (mock-mail)** | `https://whlw0bdtn6.execute-api.us-east-1.amazonaws.com/dev/mock-mail` |
| Inbox de un aprobador | `.../dev/mock-mail?to=ana@example.com` |
| **Swagger UI** | `https://whlw0bdtn6.execute-api.us-east-1.amazonaws.com/dev/docs` |
| OpenAPI spec (json) | `https://whlw0bdtn6.execute-api.us-east-1.amazonaws.com/dev/docs/openapi.json` |
| Health | `https://whlw0bdtn6.execute-api.us-east-1.amazonaws.com/dev/health` |

### Demo cast (registered in the deployed DynamoDB)

| Email | Rol | Position |
|-------|-----|----------|
| `ruth@example.com` | **Requester** | Manager |
| `ana@example.com` | Aprobador | Analyst |
| `sven@example.com` | Aprobador | Director |
| `luca@example.com` | Aprobador | Compliance |

---

## How to run the demo (deployed)

1. **Open the host** → `https://d2w6pt5r1wzlum.cloudfront.net` (hub with the two cards).
2. **Create a request** → requester panel (`/requester`) → requester `ruth@example.com`,
   approvers ana + sven + luca, title, amount, description.
3. **Get the approval links + OTPs** → demo inbox `/mock-mail` (or `?to=<email>`).
   The links point at the host (`.../approve?request_id=...&approver_token=...`).
4. **Open a link** → the composed approver UI (OTP entry).
5. **Enter the OTP** from the inbox (the correct 6-digit code for that approver).
6. **Approve** → repeat for the 3 approvers → the 3rd approval sets `COMPLETED`.
7. **Download the PDF** → requester detail, "Download PDF" (real `application/pdf` from S3).

Reject path: any approver can **Reject** (inline confirm) → first reject wins → `REJECTED`.

Concurrency check (interview): open the same link in two tabs and approve nearly
simultaneously — exactly one `COMPLETED`; approve-vs-reject → `completed XOR rejected`.

---

## Deploy infrastructure (for reference)

| Resource | Name |
|----------|------|
| CloudFormation stack | `purchase-approvals-backend-dev` |
| API Gateway stage | `/dev` |
| DynamoDB table | `purchase-approvals-dev` |
| S3 evidence bucket | `purchase-approvals-evidence-dev` |
| S3 frontend buckets | `purchase-approvals-{host,requester,approver}-dev` |
| CloudFront host | `E3MO7IAZT025ZB` → `d2w6pt5r1wzlum.cloudfront.net` |
| CloudFront requester | `E5SIJ1X2SLYTE` → `dvh7hrbuiupoy.cloudfront.net` |
| CloudFront approver | → `dc9klktisn7nb.cloudfront.net` |

### How to seed the users again (if needed)
The 4 users are registered via the deployed API (curl). See `SEED-DEPLOY.md` for the
exact curls. `db:seed` only writes the LOCAL DynamoDB — it does NOT reach the deployed
environment.

### Deploy problems encountered
See `DEPLOY-PROBLEMS.md` (repo root) — 8 deploy-only gotchas with their fixes.
