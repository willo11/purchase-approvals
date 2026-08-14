import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';

/**
 * Liveness probe for the bootstrap stack.
 * Returns `{ "status": "ok" }` so local dev (serverless-offline) and the
 * deployed stack have a health endpoint before any capability is added.
 */
export const handler = async (
  _event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ok' }),
  };
};
