import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { MailLog } from '../../application/ports/MailPort';
import { Email } from '../../domain/values/Email';
import { makeMockMailRepo } from '../../infrastructure/MockMailRepo';
import { corsHeaders } from '../cors';

function json(statusCode: number, payload: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

/**
 * Builds the `GET /mock-mail` handler (spec R2).
 *
 * Returns the simulated inbox newest first. The optional `?to=<email>` query
 * parameter simulates "one user's inbox" by restricting the log to that
 * recipient (demo hub). Only the {@link MailLog} view is needed, so unit
 * tests inject any in-memory log.
 */
export function buildListMail(log: MailLog) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const rawTo = event.queryStringParameters?.to;
    if (rawTo !== undefined && !Email.isValid(rawTo)) {
      return json(400, {
        error: 'InvalidQueryParameter',
        message: 'Query parameter "to" must be a valid email address',
      });
    }
    try {
      // Normalized (trimmed, lower-cased) recipient — matches how the registry
      // stores addresses, so the filter hits regardless of case.
      const to = rawTo === undefined ? undefined : Email.create(rawTo).toString();
      const events = await log.list(to);
      return json(200, events);
    } catch (err) {
      return json(500, {
        error: (err as Error)?.name ?? 'Error',
        message: (err as Error)?.message ?? 'Unexpected error',
      });
    }
  };
}

/** Production Lambda handler wired to the real MockMailRepo. */
export const list = buildListMail(makeMockMailRepo());