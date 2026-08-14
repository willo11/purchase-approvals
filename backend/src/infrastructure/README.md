# infrastructure/

AWS/cloud adapters implementing the application ports: DynamoDB repositories
(single-table, GSI1, TTL), mock mailer, pdf-lib PDF generator and S3 evidence
store. No domain logic lives here — these adapters translate the ports to AWS
SDK calls (design.md, Decision 8).

Capability PRs fill this folder: `#1 DynamoDbUserRepository`, `#2
DynamoDbRequestRepository`, `#3 DynamoDbApproverRepository` + OTP repo +
MockMailRepo, `#5 PdfGenerator` + S3EvidenceStore.
