import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import {
  PurchaseRequestDomainError,
  InvalidEmailError,
  UnknownUserError,
  UnknownRequestError,
} from '../../domain/errors';
import { CreateRequest } from '../../application/CreateRequest';
import { ListRequests } from '../../application/ListRequests';
import { GetRequestDetail } from '../../application/GetRequestDetail';
import { makeRequestRepository } from '../../infrastructure/DynamoDbRequestRepository';
import { makeUserRegistry } from '../../infrastructure/DynamoDbUserRegistry';
import { InMemoryTokenIssuer } from '../../infrastructure/InMemoryTokenIssuer';
import { LogMailer } from '../../infrastructure/LogMailer';

/**
 * Error → HTTP mapper following design-api.md policy.
 *
 *   Validation (empty title/description, bad amount, wrong approver set,
 *   invalid email format)                 → 400
 *   Unknown registry email                 → 404
 *   Unknown request id                     → 404
 *   Anything unexpected                    → 500
 *
 * Domain errors carry no HTTP status by design (Decision 8); mapping lives at
 * this handler boundary only.
 */
function errorToHttpStatus(err: unknown): number {
  if (err instanceof UnknownUserError || err instanceof UnknownRequestError) {
    return 404;
  }
  if (err instanceof PurchaseRequestDomainError || err instanceof InvalidEmailError) {
    return 400;
  }
  return 500;
}

function json(statusCode: number, payload: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function errorJson(err: unknown): APIGatewayProxyResult {
  const status = errorToHttpStatus(err);
  return json(status, {
    error: (err as Error)?.name ?? 'Error',
    message: (err as Error)?.message ?? 'Unexpected error',
  });
}

export function buildCreateRequest(createRequest: CreateRequest) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let body: Record<string, unknown> | null;
    try {
      body = JSON.parse(event.body ?? '{}') as Record<string, unknown> | null;
    } catch {
      return json(400, {
        error: 'Invalid JSON body',
        message: 'Body must be valid JSON',
      });
    }

    try {
      const detail = await createRequest.execute({
        title: body?.title,
        description: body?.description,
        amount: body?.amount,
        requesterEmail: body?.requesterEmail,
        approverEmails: body?.approverEmails,
      });
      return json(201, detail);
    } catch (err) {
      return errorJson(err);
    }
  };
}

export function buildListRequests(listRequests: ListRequests) {
  return async (): Promise<APIGatewayProxyResult> => {
    try {
      const summaries = await listRequests.execute();
      return json(200, summaries);
    } catch (err) {
      return errorJson(err);
    }
  };
}

export function buildGetRequestDetail(getRequestDetail: GetRequestDetail) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const id = event.pathParameters?.id ?? '';
    try {
      const detail = await getRequestDetail.execute(id);
      return json(200, detail);
    } catch (err) {
      return errorJson(err);
    }
  };
}

/**
 * Production Lambda handlers wired to the real ports.
 * serverless.yml maps:
 *   `POST /api/purchase-requests`              → create
 *   `GET  /api/purchase-requests`              → list
 *   `GET  /api/purchase-requests/{id}`         → detail
 * The token issuer and mailer are PR #2 placeholders (real wiring in PR #3).
 */
const repository = makeRequestRepository();
const registry = makeUserRegistry();
const tokenIssuer = new InMemoryTokenIssuer();
const mailer = new LogMailer();

export const create = buildCreateRequest(
  new CreateRequest(repository, registry, tokenIssuer, mailer)
);

export const list = buildListRequests(new ListRequests(repository));

export const detail = buildGetRequestDetail(new GetRequestDetail(repository));