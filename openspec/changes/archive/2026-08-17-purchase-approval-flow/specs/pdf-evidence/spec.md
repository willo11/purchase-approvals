# PDF Evidence — Delta Spec

Delta for the `pdf-evidence` capability (main spec: `openspec/specs/pdf-evidence/spec.md`). All requirements below are ADDED by this change.

## ADDED Requirements

### R1. Generation on completion

When the global status becomes `COMPLETED`, the system MUST generate a PDF containing: request title, description, amount, date, "Requester" set to the requester's resolved name from `createdBy.name`, and a signature section with exactly 3 rows (one per approver), each showing the approver's registered name (from the snapshot) and signature timestamp.

#### Scenario: PDF reflects requester and registered signature names

- GIVEN a completed request whose `createdBy.name` is "Carol" and whose 3 approvers signed with registered names and timestamps
- WHEN the PDF is generated
- THEN it contains the request data with "Requester: Carol" and 3 signature rows, each with the approver's registered name and timestamp

### R2. Storage in S3

The generated PDF MUST be stored in S3 under a deterministic key derived from the request id, so it can be retrieved by id.

#### Scenario: PDF stored per request

- GIVEN a completed request
- WHEN generation finishes
- THEN the PDF is stored at a deterministic S3 key for that request id

### R3. Download endpoint

`GET /api/purchase-requests/{id}/evidence.pdf` MUST return the PDF with `Content-Type: application/pdf` when it exists. It MUST return HTTP 404 when the request does not exist or no PDF has been generated (request not completed).

#### Scenario: Download available when completed

- GIVEN a completed request with a stored PDF
- WHEN the download endpoint is called
- THEN HTTP 200 with the PDF bytes and `application/pdf` content type

#### Scenario: Download before completion

- GIVEN a request still `PENDING`
- WHEN the download endpoint is called
- THEN HTTP 404 is returned

### R4. Generation failure handling

If PDF generation or S3 upload fails, the system MUST log the failure, keep the request status `COMPLETED`, and the download endpoint MUST return HTTP 404 until a successful generation exists.

#### Scenario: Failed generation leaves request complete

- GIVEN a request whose PDF generation failed
- WHEN the download endpoint is called
- THEN HTTP 404 is returned
- AND the request global status remains `COMPLETED`
- AND the failure is logged
