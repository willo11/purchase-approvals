# Purchase Request — Delta Spec

Delta for the `purchase-request` capability (main spec: `openspec/specs/purchase-request/spec.md`). All requirements below are ADDED by this change.

## ADDED Requirements

### R1. Create request

The system MUST create a request via `POST /api/purchase-requests` with: requester email (`createdBy`), exactly 3 approver emails selected from registered users, title (non-empty string), description (non-empty string), and amount (positive number with at most 2 decimal places, USD). The requester and all 3 approver emails MUST already exist in `user-registry`. The 3 approver emails MUST be distinct from each other and MUST differ from the requester email. The system MUST snapshot names from the registry into the item: `createdBy: {email, name}` and `approvers: [{email, name} x3]`. On success it MUST assign a unique request id, set global status `PENDING`, record the creation timestamp, create one approver record per approver email (status `PENDING`), and issue a unique UUID approval token plus simulated mail per approver (provided by `approver-otp`).

#### Scenario: Create with valid selection

- GIVEN a requester and 3 distinct approvers exist in `user-registry`
- WHEN `POST /api/purchase-requests` is called with valid title, description, amount, requester email, and 3 approver emails
- THEN a request with status `PENDING`, 3 approver records (each `PENDING`), and 3 unique tokens is returned
- AND the item stores `createdBy: {email, name}` and `approvers: [{email, name} x3]` snapshots
- AND 3 simulated approval-link mails are recorded

#### Scenario: Unknown approver email rejected

- GIVEN a payload with an approver email not present in `user-registry`
- WHEN `POST /api/purchase-requests` is called
- THEN HTTP 404 is returned
- AND no request or approver records are persisted

#### Scenario: Duplicate approver rejected

- GIVEN a payload with the same email chosen twice among the 3 approvers
- WHEN `POST /api/purchase-requests` is called
- THEN HTTP 400 is returned
- AND no request or approver records are persisted

#### Scenario: Approver equals requester rejected

- GIVEN a payload where the requester email is also one of the 3 approver emails
- WHEN `POST /api/purchase-requests` is called
- THEN HTTP 400 is returned
- AND no request or approver records are persisted

#### Scenario: Invalid payload rejected

- GIVEN a payload missing the title or description, or with amount ≤ 0 or more than 2 decimals, or with only 2 approver emails
- WHEN `POST /api/purchase-requests` is called
- THEN HTTP 400 is returned
- AND no request or approver records are persisted

### R2. Global state model

The request global status MUST be `PENDING` until it becomes `COMPLETED` (all 3 approvers signed) or `REJECTED` (any approver rejected). Both `COMPLETED` and `REJECTED` MUST be terminal: no transition out of them. Precedence: `COMPLETED` > `REJECTED` > `PENDING`.

#### Scenario: State model governs transitions

- GIVEN a request with status `PENDING`
- WHEN all 3 approvers sign
- THEN the status becomes `COMPLETED`
- AND no further state change is possible because the request is terminal

### R3. List requests

The system MUST expose a list endpoint returning all requests ordered by creation date, newest first, each with id, title, amount, global status, and creation timestamp.

#### Scenario: List after creations

- GIVEN two requests created at different times
- WHEN the list endpoint is called
- THEN both are returned, newest first

#### Scenario: Empty list

- GIVEN no requests exist
- WHEN the list endpoint is called
- THEN an empty array is returned

### R4. Request detail

The system MUST expose a detail endpoint returning request data plus each approver record keyed by email: email, name, status (`PENDING` | `SIGNED` | `REJECTED`), and signed/rejected timestamp when present. An unknown request id MUST return HTTP 404.

#### Scenario: Detail shows per-approver status

- GIVEN a request whose first approver has signed
- WHEN the detail endpoint is called
- THEN the response contains 3 approver records, the first with status `SIGNED` and a timestamp, the others `PENDING`

#### Scenario: Unknown request

- GIVEN a request id that does not exist
- WHEN the detail endpoint is called
- THEN HTTP 404 is returned
