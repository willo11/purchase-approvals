import type { APIGatewayProxyResult } from 'aws-lambda';
import { MailLog } from '../../application/ports/MailPort';
import { makeMockMailRepo } from '../../infrastructure/MockMailRepo';

function json(statusCode: number, payload: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

/**
 * Builds the `GET /mock-mail` handler (spec R2).
 *
 * Returns the simulated inbox newest first. Only the {@link MailLog} view is
 * needed, so unit tests inject any in-memory log.
 */
export function buildListMail(log: MailLog) {
  return async (): Promise<APIGatewayProxyResult> => {
    try {
      const events = await log.list();
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