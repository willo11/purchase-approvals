import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { IssueOtp } from '../../application/IssueOtp';
import { ValidateOtp } from '../../application/ValidateOtp';
import { RegenerateOtp } from '../../application/RegenerateOtp';
import { RecoverApproverOtp } from '../../application/RecoverApproverOtp';
import { ApproverGate } from '../../application/ApproverGate';
import { OtpService } from '../../domain/services/OtpService';
import {
  UnknownRequestError,
  UnknownTokenError,
  UnknownApproverError,
  TerminalRequestError,
  LockedOutError,
  ExpiredOtpError,
  WrongOtpError,
  AlreadyActedError,
  ApproverNotLockedError,
  PurchaseRequestDomainError,
} from '../../domain/errors';
import { makeRequestRepository } from '../../infrastructure/DynamoDbRequestRepository';
import { makeApproverRepository } from '../../infrastructure/DynamoDbApproverRepository';
import { makeOtpRepository } from '../../infrastructure/DynamoDbOtpRepository';
import { makeMockMailRepo } from '../../infrastructure/MockMailRepo';

/**
 * Error → HTTP mapper for the OTP endpoints (design-api policy):
 *
 *   Unknown request / unknown token / unknown approver          → 404
 *   Lockout / not-ACTIVE regenerate                              → 403
 *   Recover of a NON-locked (innocent pending) approver          → 409
 *   Terminal request / expired OTP                               → 410
 *   Wrong OTP                                                → 401 { attemptsRemaining }
 *   Malformed code (and any other domain validation)         → 400
 *   Anything unexpected                                      → 500
 */
function errorResponse(err: unknown): { status: number; body: Record<string, unknown> } {
  if (
    err instanceof UnknownRequestError ||
    err instanceof UnknownTokenError ||
    err instanceof UnknownApproverError
  ) {
    return { status: 404, body: { error: (err as Error).name, message: (err as Error).message } };
  }
  if (err instanceof LockedOutError) {
    return { status: 403, body: { error: err.name, message: err.message } };
  }
  if (err instanceof ApproverNotLockedError) {
    return { status: 409, body: { error: err.name, message: err.message } };
  }
  if (err instanceof AlreadyActedError) {
    // Shared gate: an approver who already signed/rejected re-entering the OTP
    // flow gets the "already acted" terminal screen (approver-flow R1/R4).
    return { status: 409, body: { error: err.name, message: err.message } };
  }
  if (err instanceof TerminalRequestError || err instanceof ExpiredOtpError) {
    return { status: 410, body: { error: err.name, message: err.message } };
  }
  if (err instanceof WrongOtpError) {
    return {
      status: 401,
      body: { error: err.name, message: err.message, attemptsRemaining: err.attemptsRemaining },
    };
  }
  const name = (err as Error)?.name ?? 'Error';
  const message = (err as Error)?.message ?? 'Unexpected error';
  if (err instanceof PurchaseRequestDomainError) {
    return { status: 400, body: { error: name, message } };
  }
  return { status: 500, body: { error: name, message } };
}

function json(status: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function tokens(event: APIGatewayProxyEvent): { requestId: string; token: string } {
  return {
    requestId: event.pathParameters?.requestId ?? '',
    token: event.pathParameters?.token ?? '',
  };
}

export function buildIssueOtp(useCase: IssueOtp) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { requestId, token } = tokens(event);
    try {
      const result = await useCase.execute({ requestId, token });
      return json(201, result);
    } catch (err) {
      const { status, body } = errorResponse(err);
      return json(status, body);
    }
  };
}

export function buildValidateOtp(useCase: ValidateOtp) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { requestId, token } = tokens(event);
    let code: unknown;
    try {
      code = (JSON.parse(event.body ?? '{}') as Record<string, unknown>)?.code;
    } catch {
      return json(400, { error: 'Invalid JSON body', message: 'Body must be valid JSON' });
    }
    try {
      const result = await useCase.execute({ requestId, token, code });
      return json(200, result);
    } catch (err) {
      const { status, body } = errorResponse(err);
      return json(status, body);
    }
  };
}

export function buildRegenerateOtp(useCase: RegenerateOtp) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { requestId, token } = tokens(event);
    try {
      const result = await useCase.execute({ requestId, token });
      return json(201, result);
    } catch (err) {
      const { status, body } = errorResponse(err);
      return json(status, body);
    }
  };
}

/** Recovers a locked approver's OTP: `POST .../approvers/{email}/recover` → 201. */
export function buildRecoverApproverOtp(useCase: RecoverApproverOtp) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const requestId = event.pathParameters?.requestId ?? '';
    const email = event.pathParameters?.email ?? '';
    try {
      const result = await useCase.execute({ requestId, email });
      return json(201, result);
    } catch (err) {
      const { status, body } = errorResponse(err);
      return json(status, body);
    }
  };
}

/**
 * Production Lambda handlers wired to the real ports.
 * serverless.yml maps:
 *   POST /api/approvals/{requestId}/token/{token}/otp           → issue
 *   POST /api/approvals/{requestId}/token/{token}/otp/validate  → validate
 *   POST /api/approvals/{requestId}/token/{token}/otp/regenerate→ regenerate
 */
const requests = makeRequestRepository();
const approvers = makeApproverRepository();
const otps = makeOtpRepository();
const mail = makeMockMailRepo();
const gate = new ApproverGate(requests, approvers);
const otpService = new OtpService();

export const issue = buildIssueOtp(new IssueOtp(gate, otps, otpService, mail));
export const validate = buildValidateOtp(new ValidateOtp(gate, approvers, otps, otpService));
export const regenerate = buildRegenerateOtp(
  new RegenerateOtp(gate, approvers, otps, otpService, mail)
);
export const recover = buildRecoverApproverOtp(
  new RecoverApproverOtp(requests, approvers, otps, otpService, mail)
);