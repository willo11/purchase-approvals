# User Registry Specification

## Purpose

Define the employee registry: registration and listing of users identified by their email address. This registry is the source of the requester and approver identities referenced by `purchase-request` and `approval-signature`.

Dependencies: none. This is the first capability in the PR chain (`user-registry` -> `purchase-request` -> `approver-otp` -> `approval-signature` -> `pdf-evidence` -> `requester-panel` -> `approver-flow`); every other capability depends on its email identity.

Auth note: identity is email-only for the demo. No password is stored. Authentication/authorization is documented as a future improvement and is NOT a requirement of this spec.

## Requirements

### R1. Register employee

The system MUST register an employee via `POST /api/users` with: name (non-empty string), email (valid format, unique natural key), and position (job position, optional string with a default when omitted). A valid registration MUST persist the user keyed by email and return the created user. An email that already exists MUST return HTTP 409. A payload with an empty name or an invalid email format MUST return HTTP 400. No password is accepted or stored.

#### Scenario: Successful registration

- GIVEN a payload with a valid name, email, and position
- WHEN `POST /api/users` is called
- THEN HTTP 201 returns the user with name, email, and position
- AND the user is persisted under the email key

#### Scenario: Duplicate email rejected

- GIVEN a user with email ana@example.com already registered
- WHEN `POST /api/users` is called with the same email
- THEN HTTP 409 is returned
- AND no duplicate user is persisted

#### Scenario: Invalid email rejected

- GIVEN a payload whose email is not a valid email format
- WHEN `POST /api/users` is called
- THEN HTTP 400 is returned
- AND no user is persisted

#### Scenario: Position optional

- GIVEN a payload with a valid name and email but no position
- WHEN `POST /api/users` is called
- THEN the user is registered with the default position value

### R2. List employees

The system MUST expose `GET /api/users` returning all registered employees with name, email, and position, ordered by registration.

#### Scenario: Listing returns registered users

- GIVEN two users registered
- WHEN `GET /api/users` is called
- THEN both are returned with name, email, and position

#### Scenario: Empty registry

- GIVEN no users registered
- WHEN `GET /api/users` is called
- THEN an empty array is returned
