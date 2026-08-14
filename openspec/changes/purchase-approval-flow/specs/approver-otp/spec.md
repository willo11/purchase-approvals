# Approver OTP — Delta Spec

Delta for the `approver-otp` capability (main spec: `openspec/specs/approver-otp/spec.md`). All requirements below are ADDED by this change.

## ADDED Requirements

### R1. Approval token and link

Each approver record MUST be issued a unique, URL-safe UUID token. The approval link MUST have the form `https://<host>/approve?solicitud_id=<request_id>&approver_token=<uuid>`.

#### Scenario: Unique tokens per approver

- GIVEN a request created with 3 approvers
- WHEN the tokens are inspected
- THEN each approver has a distinct UUID and a distinct approval link

### R2. Simulated mail log

Every simulated mail (approval links, later OTPs) MUST be recorded in a mail log and exposed via `GET /mock-mail`, newest first, for demo/QA.

#### Scenario: Mock mail lists sent messages

- GIVEN a request created and an OTP issued
- WHEN `GET /mock-mail` is called
- THEN the log lists the 3 link mails and the OTP mail with recipient and content

### R3. OTP issuance

The system MUST generate a 6-digit numeric OTP unique per approver, store only its SHA-256 hash with an expiry of 3 minutes from issuance, and deliver it via simulated mail.

#### Scenario: OTP issued per approver

- GIVEN an approver requests an OTP
- WHEN issuance completes
- THEN a 6-digit OTP is mailed and only its hash is stored with a 3-minute expiry

### R4. OTP validation enforces expiry in code

Validation MUST compare the submitted code against the stored hash and MUST reject codes past their expiry in code; DynamoDB TTL is a cleanup mechanism, not the expiry gate. A successful validation MUST consume the OTP (one-time use).

#### Scenario: Correct OTP succeeds

- GIVEN an unexpired OTP for an approver
- WHEN the approver submits the correct code
- THEN validation succeeds and the OTP cannot be reused

#### Scenario: Expired OTP rejected before TTL cleanup

- GIVEN an OTP issued 4 minutes ago whose record still exists in the table
- WHEN the approver submits the correct code
- THEN validation fails with "expired" because expiry is checked in code

### R5. Failed attempts lockout

Three consecutive failed validations for an approver MUST permanently invalidate that approver's token: no further OTP validation or new-OTP issuance succeeds.

#### Scenario: Lockout after 3 failures

- GIVEN an approver with 2 failed attempts
- WHEN a third wrong code is submitted
- THEN the token is invalidated and even the correct code is rejected

### R6. New OTP after expiry

For an expired OTP (before lockout), the system MUST support a "generate new OTP" action that issues a fresh OTP with a new 3-minute expiry via simulated mail and resets the failed-attempt counter.

#### Scenario: Regenerate after expiry

- GIVEN an approver whose OTP expired with 1 failed attempt
- WHEN the approver requests a new OTP
- THEN a new OTP with fresh expiry is mailed and failed attempts reset to 0

### R7. Token entry gate

Before any OTP flow, the system MUST resolve the token and check the global request state and the approver's own state; when the approver already signed/rejected or the request is `Rechazada`/`Completada`, the system MUST return a terminal-state response blocking any OTP issuance or validation.

#### Scenario: Terminal state blocks OTP

- GIVEN a request that another approver rejected
- WHEN an approver opens their link
- THEN the response indicates the request was rejected and no OTP flow is offered
