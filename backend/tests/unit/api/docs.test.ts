import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handlerDocs, handlerSpec } from '../../../src/api/handlers/docs';

function docsEvent(stage = 'dev'): APIGatewayProxyEvent {
  return {
    requestContext: { stage },
  } as unknown as APIGatewayProxyEvent;
}

function specEvent(
  headers: Record<string, string>,
  stage: string
): APIGatewayProxyEvent {
  return {
    headers,
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

  it('derives servers[0] from the Host header + stage (offline-style request)', async () => {
    const response = await handlerSpec(
      specEvent({ Host: 'localhost:4000' }, 'dev')
    );

    expect(response.statusCode).toBe(200);
    const spec = JSON.parse(response.body) as {
      servers: Array<{ url: string; description?: string }>;
      paths: Record<string, unknown>;
    };
    expect(spec.servers[0]).toEqual({
      url: 'http://localhost:4000/dev',
      description: 'This API (derived at request time)',
    });
    expect(Object.keys(spec.paths)).toHaveLength(12);
  });

  it('derives an https base for a deployed request via X-Forwarded-Proto', async () => {
    const response = await handlerSpec(
      specEvent(
        {
          Host: 'abcdef1234.execute-api.us-east-1.amazonaws.com',
          'X-Forwarded-Proto': 'https',
        },
        'prod'
      )
    );

    const spec = JSON.parse(response.body) as {
      servers: Array<{ url: string }>;
    };
    expect(spec.servers[0].url).toBe(
      'https://abcdef1234.execute-api.us-east-1.amazonaws.com/prod'
    );
  });

  it('serves the committed servers verbatim when the context lacks the pieces', async () => {
    const response = await handlerSpec(
      {} as unknown as APIGatewayProxyEvent
    );

    expect(response.statusCode).toBe(200);
    const spec = JSON.parse(response.body) as {
      servers: Array<{ url: string; description?: string }>;
    };
    expect(spec.servers[0].url).toBe('http://localhost:4000/dev');
    expect(spec.servers[0].description).toBe(
      'Local development (serverless-offline)'
    );
  });
});