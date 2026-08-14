# purchase-approvals

## Overview

Serverless purchase-approval flow with concatenated digital signatures.

A requester creates a purchase request (title, description, amount, 3 approvers). The system stores it with status "PENDING", generates a unique UUID token per approver, and simulates an email containing an approval link. An approver validates a time-limited OTP (valid for 3 minutes), reviews the purchase details, and approves or rejects. Each approval records a digital signature (name + date) and the request status moves to "SIGNED" / "REJECTED". When all 3 approvers have signed, the backend generates a PDF evidence document (request data + approvers/signatures table), stores it, and exposes a download endpoint; the request status becomes "COMPLETED".

## Architecture

- Backend: Node.js/TypeScript, serverless AWS (Lambda/Step Functions, API Gateway, DynamoDB, S3, PDF generation)
- Frontend: React 17+ (axios, React Router, webpack)
- Mobile: React Native (planned, later)
- REST APIs consumed by the web frontend and later by the React Native app
- Repository layout: `backend/`, `frontend/`, `mobile/` (empty scaffold, no source files yet)

## Delivery Requirements

- README
- Swagger/OpenAPI API documentation
- Tests with >=60% coverage