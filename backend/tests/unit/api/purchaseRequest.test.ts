import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  buildCreateRequest,
  buildListRequests,
  buildGetRequestDetail,
} from '../../../src/api/handlers/purchaseRequest';
import { CreateRequest } from '../../../src/application/CreateRequest';
import { ListRequests } from '../../../src/application/ListRequests';
import { GetRequestDetail } from '../../../src/application/GetRequestDetail';
import { FakeUserRegistry } from '../helpers/fakeUserRegistry';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeTokenIssuer } from '../helpers/fakeTokenIssuer';
import { FakeMailPort } from '../helpers/fakeMailPort';
import {
  validCreateInput,
  registeredUsers,
} from '../helpers/purchaseRequestFixture';
import type { RequestRepository } from '../../../src/application/ports/RequestRepository';

function postEvent(body: unknown): APIGatewayProxyEvent {
  return { body: JSON.stringify(body) } as unknown as APIGatewayProxyEvent;
}

function getEvent(id: string): APIGatewayProxyEvent {
  return { pathParameters: { id } } as unknown as APIGatewayProxyEvent;
}

function buildCreateHandler() {
  const registry = new FakeUserRegistry().seed(...registeredUsers);
  const repository = new FakeRequestRepository();
  const tokenIssuer = new FakeTokenIssuer();
  const mail = new FakeMailPort();
  const handler = buildCreateRequest(
    new CreateRequest(repository, registry, tokenIssuer, mail)
  );
  return handler;
}

/** Port stub that throws a NON-domain error, to prove unknown failures → 500. */
function throwingRepo(): RequestRepository {
  return {
    async create() {
      throw new Error('DynamoDB unreachable');
    },
    async list() {
      throw new Error('DynamoDB unreachable');
    },
    async get() {
      throw new Error('DynamoDB unreachable');
    },
  };
}

describe('create handler (POST /api/purchase-requests)', () => {
  it('returns 201 with the request detail on a valid payload (R1)', async () => {
    const response = await buildCreateHandler()(postEvent(validCreateInput()));

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('PENDING');
    expect(body.createdBy).toEqual({ email: 'ana@example.com', name: 'Ana' });
    expect(body.approvers).toHaveLength(3);
    expect(typeof body.id).toBe('string');
  });

  it('returns 400 for a validation error (duplicate approver)', async () => {
    const input = { ...validCreateInput() };
    (input.approverEmails as string[])[1] = (input.approverEmails as string[])[0];

    const response = await buildCreateHandler()(postEvent(input));

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for an invalid amount', async () => {
    const input = { ...validCreateInput(), amount: -5 };
    const response = await buildCreateHandler()(postEvent(input));
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const event = { body: '{not json' } as unknown as APIGatewayProxyEvent;
    const response = await buildCreateHandler()(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when the requester or an approver is not registered', async () => {
    const input = { ...validCreateInput(), requesterEmail: 'ghost@example.com' };
    const response = await buildCreateHandler()(postEvent(input));
    expect(response.statusCode).toBe(404);

    const input2 = { ...validCreateInput() };
    (input2.approverEmails as string[])[2] = 'ghost@example.com';
    const response2 = await buildCreateHandler()(postEvent(input2));
    expect(response2.statusCode).toBe(404);
  });

  it('returns 500 when the repository fails with a non-domain error', async () => {
    const handler = buildCreateRequest(
      new CreateRequest(
        throwingRepo(),
        new FakeUserRegistry().seed(...registeredUsers),
        new FakeTokenIssuer(),
        new FakeMailPort()
      )
    );
    const response = await handler(postEvent(validCreateInput()));
    expect(response.statusCode).toBe(500);
  });
});

describe('list handler (GET /api/purchase-requests)', () => {
  it('returns 200 with an empty array when no requests exist (R3 empty list)', async () => {
    const handler = buildListRequests(new ListRequests(new FakeRequestRepository()));
    const response = await handler();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([]);
  });
});

describe('detail handler (GET /api/purchase-requests/{id})', () => {
  it('returns 200 with the request detail (R4)', async () => {
    const repo = new FakeRequestRepository();
    const handler = buildGetRequestDetail(new GetRequestDetail(repo));

    // seed via the real use case path through the fake repository
    await new CreateRequest(
      repo,
      new FakeUserRegistry().seed(...registeredUsers),
      new FakeTokenIssuer(),
      new FakeMailPort()
    ).execute(validCreateInput());

    const created = (await repo.list())[0];
    const response = await handler(getEvent(created.id));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).approvers.map((a: { status: string }) => a.status)).toEqual([
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
  });

  it('returns 404 for an unknown request id (R4)', async () => {
    const handler = buildGetRequestDetail(new GetRequestDetail(new FakeRequestRepository()));
    const response = await handler(getEvent('missing'));
    expect(response.statusCode).toBe(404);
  });

  it('returns 500 when the repository fails with a non-domain error', async () => {
    const handler = buildGetRequestDetail(new GetRequestDetail(throwingRepo()));
    const response = await handler(getEvent('anything'));
    expect(response.statusCode).toBe(500);
  });
});