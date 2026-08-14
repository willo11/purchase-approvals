import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { UserDomainError, EmptyNameError, InvalidEmailError } from '../../domain/errors';
import { RegisterUser } from '../../application/RegisterUser';
import { ListUsers } from '../../application/ListUsers';
import { makeUserRepository } from '../../infrastructure/DynamoDbUserRepository';

/**
 * Error → HTTP mapper following design-api.md policy.
 *
 *   Validation (empty name, bad email)  → 400
 *   Duplicate email (register)          → 409
 *   Anything unexpected                 → 500
 *
 * Domain errors carry no HTTP status by design (Decision 8); mapping lives at
 * this handler boundary only.
 */
function errorToHttpStatus(err: unknown): number {
  if (err instanceof UserDomainError) {
    if (err instanceof EmptyNameError || err instanceof InvalidEmailError) {
      return 400;
    }
    // UserAlreadyExistsError and any other domain conflict → 409
    return 409;
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

export function buildCreateUser(registerUser: RegisterUser) {
  return async (
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> => {
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return json(400, { error: 'Invalid JSON body', message: 'Body must be valid JSON' });
    }

    try {
      const user = await registerUser.execute({
        name: (body as Record<string, unknown> | null)?.name,
        email: (body as Record<string, unknown> | null)?.email,
        position: (body as Record<string, unknown> | null)?.position,
      });
      return json(201, user.toPrimitives());
    } catch (err) {
      const status = errorToHttpStatus(err);
      return json(status, {
        error: (err as Error)?.name ?? 'Error',
        message: (err as Error)?.message ?? 'Unexpected error',
      });
    }
  };
}

export function buildListUsers(listUsers: ListUsers) {
  return async (): Promise<APIGatewayProxyResult> => {
    try {
      const users = await listUsers.execute();
      return json(200, users.map((user) => user.toPrimitives()));
    } catch (err) {
      const status = errorToHttpStatus(err);
      return json(status, {
        error: (err as Error)?.name ?? 'Error',
        message: (err as Error)?.message ?? 'Unexpected error',
      });
    }
  };
}

/**
 * Production Lambda handlers wired to the real repository.
 * serverless.yml maps `POST /api/users` → createUser, `GET /api/users` → listUsers.
 */
const repository = makeUserRepository();

export const createUser = buildCreateUser(new RegisterUser(repository));

export const listUsers = buildListUsers(new ListUsers(repository));