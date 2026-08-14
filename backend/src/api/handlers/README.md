# src/api/handlers

Lambda handler modules, one per capability (design-api.md mapping):
`userRegistry.ts`, `purchaseRequest.ts`, `otp.ts`, `signature.ts`,
`evidence.ts`, `mockMail.ts`. Handlers stay thin: parse the API Gateway event,
call the use case, map errors to HTTP via the error-to-HTTP policy
(design-api.md).

PR #0 ships the `/health` function at `src/api/health.ts`; the capability
handlers land with PRs #1-#5.
