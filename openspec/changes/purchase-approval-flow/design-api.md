# API Contract & Frontend Mapping (Detail)

Base path from API Gateway. JSON requests/responses unless noted.

## Common shapes

- `User { name: string; email: string; position?: string; }`
- `ApproverView { email; name; status: 'PENDING'|'SIGNED'|'REJECTED'; signedAt?: string; rejectedAt?: string }`
- `RequestSummary { id; title; amount; currency:'USD'; status; createdAt }`
- `RequestDetail extends RequestSummary { description; createdBy:{email,name}; approvers: ApproverView[3]; excluded; evidenceUrl?: string; rejectedBy?: string }`
- `Error { error: string; message: string }`

## Error → HTTP policy

| Error | HTTP |
|---|---|
| Validation (empty name, bad email, amount≤0/>2dec, wrong approver count) | 400 |
| Duplicate email (register) / already-acted (approve/reject dup) | 409 |
| Unknown request id | 404 |
| Unknown/expired token | 404 |
| Wrong OTP | 401 (payload `{attemptsRemaining}`) |
| Lockout / wrong-token condition | 403 |
| Terminal global state (COMPLETED/REJECTED), expired allowed regenerate | 410 |

## Endpoints (complete)

### users
| # | Method Path | Request | Success | Errors |
|---|---|---|---|---|
| 1 | POST /api/users | {name,email,position?} | 201 `User` | 400, 409 |
| 2 | GET /api/users | — | 200 `User[]` (creation order) | — |

### requests
| # | Method Path | Request | Success | Errors |
|---|---|---|---|---|
| 3 | POST /api/purchase-requests | {title,description,amount,requesterEmail,approverEmails[3]} | 201 `RequestDetail` | 400, 404 (unknown registry emails) |
| 4 | GET /api/purchase-requests | — | 200 `RequestSummary[]` newest first | — |
| 5 | GET /api/purchase-requests/{id} | — | 200 `RequestDetail` | 404 |
| 6 | GET /api/purchase-requests/{id}/evidence.pdf | — | 200 binary `application/pdf` | 404 |

### approver OTP flow (gate = token resolves + terminality)
All under `/api/approvals/{requestId}/token/{token}`.
| # | Method Path | Request | Success | Errors |
|---|---|---|---|---|
| 7 | POST .../otp | — | 201 `{expiresInSeconds:180}` | 404, 403, 409, 410 |
| 8 | POST .../otp/validate | {code} | 200 `{valid:true}` | 400 (format), 401 `{attemptsRemaining}`, 403, 409, 410 |
| 9 | POST .../otp/regenerate | — | 201 `{expiresInSeconds:180}` | 403, 409, 410 |

> The shared `ApproverGate` (also used by the signature endpoints) adds an
> **already-acted → 409** check, so OTP endpoints on a token whose approver
> already signed/rejected return 409. A SUCCESSFUL `.../otp/validate` durably
> writes a `validatedAt` marker on the approver row; approve/reject require it
> (missing → 401) — see #10/#11 and DECISIONS #22.

### approver decision
| # | Method Path | Request | Success | Errors |
|---|---|---|---|---|
| 10 | POST .../approve | — | 201 `RequestDetail` | 404, 401, 409, 410 |
| 11 | POST .../reject | {confirm:true} | 201 `RequestDetail` | 404, 401, 409, 410 |

### mock mail
| # | Method Path | Request | Success | Errors |
|---|---|---|---|---|
| 12 | GET /mock-mail | — | 200 `MailEvent[]` newest first | — |

`MailEvent { id; to; type:'APPROVAL_LINK'|'OTP'; subject; body; link?; otpPlain?; createdAt }` — `otpPlain` is included ONLY in the simulated mail for demo/QA (never stored hashed; mock discloses for the reviewer to drive the flow). Link form: `https://<host>/approve?request_id=<id>&approver_token=<uuid>`.

## Frontend → backend mapping (no orphan calls)

### host (shell)
- Route `/` landing/menu → no API (static shell).

### `requester` remote — routes `/requester`, `/requester/new`, `/requester/:id`
| Screen / action | Endpoint |
|---|---|
| Load list | #4 GET /api/purchase-requests |
| Open create form (user selectors) | #2 GET /api/users |
| Submit create | #3 POST /api/purchase-requests |
| Load detail + approver table | #5 GET /api/purchase-requests/{id} |
| Download PDF button (only if `status=COMPLETED`) | #6 GET /api/purchase-requests/{id}/evidence.pdf (blob download) |

### `approver` remote — route `/approve?request_id=..&approver_token=..`
| Screen / action | Endpoint |
|---|---|
| Resolve link → gate (terminal? lockout? prompt for OTP?) | #7 POST .../otp (terminal 410 / lockout 403 / issues OTP) |
| Submit 6-digit code | #8 POST .../otp/validate |
| "Generate new OTP" (expired) | #9 POST .../otp/regenerate |
| Approve (no name input) | #10 POST .../approve |
| Reject (require confirm) | #11 POST .../reject |
| Terminal screens (already signed/rejected/completed) | derived from #7/#8 failure status codes + #5 detail |

### guarantee
Every axios call in either remote resolves to one of #1–#12; no frontend action lacks a backend contract.

## serverless.yml mapping (one Lambda handler per function, bound to routes)

| Function | Handler file (src/api/handlers) | routes |
|---|---|---|
| `register-user` | userRegistry.ts `createUser` | 1 |
| `list-users` | userRegistry.ts `listUsers` | 2 |
| `create-request` | purchaseRequest.ts `create` | 3 |
| `list-requests` | purchaseRequest.ts `list` | 4 |
| `request-detail` | purchaseRequest.ts `detail` | 5 |
| `evidence-download` | evidence.ts `download` | 6 |
| `issue-otp` | otp.ts `issue` | 7 |
| `validate-otp` | otp.ts `validate` | 8 |
| `regenerate-otp` | otp.ts `regenerate` | 9 |
| `approve` | signature.ts `approve` | 10 |
| `reject` | signature.ts `reject` | 11 |
| `mock-mail` | mockMail.ts `list` | 12 |

Grouped handlers keep capability modules independent: userRegistry, purchaseRequest, otp, signature, evidence, mockMail. One `serverless.yml` declares the single DynamoDB table (`TableName`, `PK`/`SK`, `GSI1` with `gsi1pk`/`gsi1sk`, TTL on `otpExpiresAt`), the S3 bucket, and each function's `events` (http path/method). Serverless-offline + `DYNAMODB_LOCAL` for dev.