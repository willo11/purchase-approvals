# Approval Signature — Delta Spec

Delta for the `approval-signature` capability (main spec: `openspec/specs/approval-signature/spec.md`). All requirements below are ADDED by this change.

## ADDED Requirements

### R1. Approve

Given a validated OTP, the system MUST record a signature for that approver: the APPROVER'S REGISTERED name (from the `user-registry` snapshot persisted at request creation) + a signing timestamp. The name MUST NOT be typed by the approver at signing time. The system MUST set the approver status to `Firmado` and persist the signed timestamp.

#### Scenario: Approver signs with registered name

- GIVEN an approver with a validated OTP on a `Pendiente` request whose snapshot name is "Ana"
- WHEN the approver approves
- THEN the approver's status is `Firmado` with the registered name "Ana" and a timestamp
- AND no name input is requested from the approver

### R2. Reject is globally terminal

Given a validated OTP, the system MUST set the approver status to `Rechazado` with timestamp AND set the global request status to `Rechazada` immediately. After any rejection, every other approver link MUST be blocked (informational "already rejected"), and no approve/reject can succeed.

#### Scenario: Rejection terminates the request

- GIVEN a request with 3 pending approvers
- WHEN one approver rejects
- THEN the request status is `Rechazada` and the rejecting approver's status is `Rechazado`

#### Scenario: Other approvers blocked after rejection

- GIVEN a request already `Rechazada`
- WHEN another approver submits approve with a valid OTP
- THEN the action is rejected with an informational terminal-state response

### R3. Completion on third signature

When the 3rd approver signs, the system MUST set the global status to `Completada` and trigger PDF evidence generation (`pdf-evidence`).

#### Scenario: Third signature completes the request

- GIVEN a request with 2 signed approvers
- WHEN the 3rd approver signs
- THEN the global status becomes `Completada` and PDF generation is triggered

### R4. Atomic transitions under concurrency

All approve/reject transitions MUST use conditional writes on the global state and the approver record, so two concurrent actions on the same request cannot both commit stale updates. Actions on an already-terminal request or an already-terminal approver MUST fail.

#### Scenario: Concurrent signatures do not lose updates

- GIVEN a request with 1 signed approver and 2 pending approvers acting concurrently
- WHEN both approve at the same time
- THEN exactly one is the 3rd signature that completes the request, both signatures are recorded, and the global status is `Completada`

#### Scenario: Same approver cannot sign twice

- GIVEN an approver who already signed
- WHEN the same approve action is submitted again
- THEN it fails with "already signed" and no second signature is recorded
