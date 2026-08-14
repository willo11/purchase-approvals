# domain/

Entities, value objects and enums with zero framework dependencies (design.md,
Decision 8). The heart of the flow: `User`, `PurchaseRequest`, `Approver`,
`Amount`, `Email`, status enums.

Capability PRs fill this folder: `#1 user-registry` (User/Email), `#2
purchase-request` (PurchaseRequest/Approver/Amount/GlobalStatus),
`#3 approver-otp` (OTP value object, Token).
