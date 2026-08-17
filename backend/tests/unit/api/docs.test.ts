import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handlerDocs, handlerSpec } from '../../../src/api/handlers/docs';

function docsEvent(stage = 'dev'): APIGatewayProxyEvent {
  return {
    requestContext: { stage },
  } as unknown as APIGatewayProxyEvent;
}

describe('GET /docs handler (Swagger UI)', () => {
  it('returns 200 text/html containing SwaggerUIBundle and the spec url under the stage', async () => {
    const response = await handlerDocs(docsEvent('dev'));

    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Content-Type']).toContain('text/html');
    expect(response.body).toContain('SwaggerUIBundle');
    expect(response.body).toContain('/dev/docs/openapi.json');
  });

  it('points the spec url at the API Gateway stage from requestContext', async () => {
    const response = await handlerDocs(docsEvent('prod'));

    expect(response.body).toContain('/prod/docs/openapi.json');
    expect(response.body).not.toContain('/dev/docs/openapi.json');
  });

  it('defaults to the dev stage when requestContext.stage is missing', async () => {
    const response = await handlerDocs({} as unknown as APIGatewayProxyEvent);

    expect(response.body).toContain('/dev/docs/openapi.json');
  });
});

describe('GET /docs/openapi.json handler (OpenAPI spec)', () => {
  it('returns 200 application/json with a spec object exposing the 12 paths', async () => {
    const response = await handlerSpec();

    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Content-Type']).toBe('application/json');

    const spec = JSON.parse(response.body) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toHaveLength(12);
  });
});
