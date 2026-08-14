# Approver Flow Specification

## Purpose

Define the approver-facing frontend (`aprobador` remote): token screen with terminal-state gating, OTP entry, request detail with Approve/Reject, and terminal-state screens. All data flows over REST (axios/fetch). No authentication.

Dependencies: backend REST API for `approver-otp` (token gate, OTP) and `approval-signature` (approve/reject). The approver's name is not collected in this UI; it comes from the registered `user-registry` snapshot.

## Requirements

### R1. Link resolution and terminal gate

Opening `/approve?request_id=<id>&approver_token=<uuid>` MUST resolve the token via REST and, when the approver already signed/rejected or the request is `REJECTED`/`COMPLETED`, MUST show an informational terminal screen with no actions.

#### Scenario: Request already rejected

- GIVEN a request rejected by another approver
- WHEN an approver opens their link
- THEN an informational "already rejected" screen is shown and no OTP or action UI appears

#### Scenario: Approver already signed

- GIVEN an approver who already signed
- WHEN they open their link again
- THEN an informational "already signed" screen is shown and no actions appear

### R2. OTP entry screen

For a valid pending approver, the screen MUST show a 6-digit OTP input, submit it via REST, and handle responses: wrong code shows the error with remaining attempts; 3 failures show a lockout screen; expired OTP offers a "generate new OTP" action (simulated re-send).

#### Scenario: OTP accepted

- GIVEN an approver with a valid unexpired OTP
- WHEN they enter the correct 6 digits
- THEN they advance to the request detail screen

#### Scenario: Lockout after 3 attempts

- GIVEN an approver who entered 2 wrong codes
- WHEN a 3rd wrong code is submitted
- THEN a lockout screen is shown and further attempts are blocked

#### Scenario: Expired OTP regeneration

- GIVEN the approver's OTP has expired
- WHEN they submit a code and then choose "generate new OTP"
- THEN a new OTP is delivered (simulated) and entry restarts with a fresh 3-minute window

### R3. Detail screen with Approve/Reject

After OTP validation, the screen MUST show the request data and Approve/Reject controls. Approve MUST NOT ask for the approver's name (the registered name from the snapshot is used); Reject MUST require confirmation.

#### Scenario: Approve without entering a name

- GIVEN an approver on the detail screen
- WHEN they click Approve
- THEN the REST approve call succeeds and a success screen is shown
- AND the recorded signature uses the approver's registered name

### R4. Terminal screens after acting

After a successful approve/reject, or when the flow hits a terminal state, the screen MUST show the resulting state and block any further action.

#### Scenario: Post-rejection terminality

- GIVEN an approver who rejected a request
- WHEN they reload their link
- THEN the terminal "already rejected" screen is shown