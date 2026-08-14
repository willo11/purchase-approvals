# Requester Panel Specification

## Purpose

Define the requester-facing frontend (host + `requester` remote): list, create, detail with per-approver status, and PDF download. All data flows over REST (axios/fetch). No authentication.

Dependencies: backend REST API for `user-registry` (user list for the create form), `purchase-request`, and `pdf-evidence`.

## Requirements

### R1. Request list

The panel MUST render the list of requests fetched via REST, showing title, amount, global status, and creation date for each, newest first.

#### Scenario: List renders

- GIVEN the backend returns 2 requests
- WHEN the list screen loads
- THEN both appear with title, amount, status, and date, newest first

#### Scenario: Empty state

- GIVEN the backend returns no requests
- WHEN the list screen loads
- THEN an empty-state message is shown

### R2. Create request form

The panel MUST provide a form with a requester email selector, exactly 3 approver email selectors, title, description, and amount. The selectors MUST be populated from `GET /api/users`, and the requester selector MUST NOT allow selecting the same email as any approver. On submit the panel MUST call the create REST API and, on success, navigate to the new request's detail. Server validation errors MUST be displayed.

#### Scenario: User list loads on create screen

- GIVEN the registry returns 5 registered users
- WHEN the create screen opens
- THEN the requester and approver selectors show the 5 registered users

#### Scenario: Create succeeds

- GIVEN the user list is loaded and a requester selects their own email plus 3 distinct approver emails
- WHEN they submit
- THEN the request is created and the requester lands on its detail screen

#### Scenario: Validation error shown

- GIVEN a form missing the title or with an approver email not in the user list
- WHEN they submit
- THEN the API's error message is displayed and no navigation happens

### R3. Request detail

The panel MUST render request data and a table of the 3 approvers with name, email, and status `PENDING` / `SIGNED` (with date) / `REJECTED` (with date), fetched via REST.

#### Scenario: Per-approver status rendered

- GIVEN a request whose 2 approvers signed and 1 is pending
- WHEN the detail screen loads
- THEN the table shows 2 `SIGNED` rows with dates and 1 `PENDING` row

### R4. PDF download

When the global status is `COMPLETED`, the detail screen MUST show a "Download PDF" button that downloads `GET /api/purchase-requests/{id}/evidence.pdf`. The button MUST NOT be shown otherwise.

#### Scenario: Download offered only when completed

- GIVEN a completed request
- WHEN the detail screen renders
- THEN a "Download PDF" button is shown and clicking it downloads the PDF

#### Scenario: No button before completion

- GIVEN a request with status `PENDING`
- WHEN the detail screen renders
- THEN no download button is shown

### R5. REST-only and error handling

All screens MUST consume only the REST API via axios/fetch, and any API failure MUST be surfaced to the user without crashing the screen.

#### Scenario: API error surfaced

- GIVEN the list endpoint returns HTTP 500
- WHEN the list screen loads
- THEN an error message is shown and the screen remains usable