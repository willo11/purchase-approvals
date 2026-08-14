import type {
  APIGatewayProxyEvent,
  Context,
} from 'aws-lambda';
import { handler } from '../../../src/api/health';

describe('health handler', () => {
  it('returns 200 with status ok', async () => {
    const event = {} as unknown as APIGatewayProxyEvent;
    const context = {} as unknown as Context;

    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
  });
});
