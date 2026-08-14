# application/

Use cases + port interfaces (the contract between the core and the outside
world). Each capability maps to one or more use cases backed by ports, e.g.
`UserRepository`, `TokenIssuerPort`, `MailPort`, `EvidenceGeneratorPort`.
Handlers and infrastructure are thin adapters behind these ports, which keeps
the core unit-testable without AWS (design.md, Decision 8).

Capability PRs fill this folder: `#1 RegisterUser`/`ListUsers`,
`#2 CreateRequest`/`ListRequests`/`GetRequestDetail`,
`#3 IssueOtp`/`ValidateOtp`/`RegenerateOtp`,
`#4 ApproveRequest`/`RejectRequest`.
