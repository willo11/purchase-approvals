import type { APIGatewayProxyEvent } from 'aws-lambda';
import { buildCreateUser, buildListUsers } from '../../../src/api/handlers/userRegistry';
import { RegisterUser } from '../../../src/application/RegisterUser';
import { ListUsers } from '../../../src/application/ListUsers';
import { FakeUserRepository } from '../helpers/fakeUserRepository';
import { User } from '../../../src/domain/User';
import type { UserRepository } from '../../../src/application/ports/UserRepository';

function postEvent(body: unknown): APIGatewayProxyEvent {
  return { body: JSON.stringify(body) } as unknown as APIGatewayProxyEvent;
}

/** Port stub that throws a NON-domain error, to prove the handler maps unknown failures to 500. */
function throwingRepo(): UserRepository {
  return {
    async save() {
      throw new Error('DynamoDB unreachable');
    },
    async listAll() {
      throw new Error('DynamoDB unreachable');
    },
  };
}

describe('createUser handler (POST /api/users)', () => {
  it('returns 201 with the created user (r1 successful registration)', async () => {
    const repo = new FakeUserRepository();
    const handler = buildCreateUser(new RegisterUser(repo));

    const response = await handler(postEvent({ name: 'Ana', email: 'ana@example.com', position: 'Accountant' }));

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      position: 'Accountant',
    });
  });

  it('returns 201 applying the default position when omitted (position optional)', async () => {
    const handler = buildCreateUser(new RegisterUser(new FakeUserRepository()));

    const response = await handler(postEvent({ name: 'Ana', email: 'ana@example.com' }));

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).position).toBe('Employee');
  });

  it('returns 409 on a duplicate email and does not persist', async () => {
    const repo = new FakeUserRepository().seed(
      User.create({ name: 'Ana', email: 'ana@example.com' })
    );
    const handler = buildCreateUser(new RegisterUser(repo));

    const response = await handler(postEvent({ name: 'Ana Dupe', email: 'ana@example.com' }));

    expect(response.statusCode).toBe(409);
    expect(repo.count()).toBe(1); // no duplicate persisted
  });

  it('returns 400 for an invalid email format', async () => {
    const handler = buildCreateUser(new RegisterUser(new FakeUserRepository()));

    const response = await handler(postEvent({ name: 'Ana', email: 'not-an-email' }));

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for an empty name', async () => {
    const handler = buildCreateUser(new RegisterUser(new FakeUserRepository()));

    const response = await handler(postEvent({ name: '', email: 'ana@example.com' }));

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const handler = buildCreateUser(new RegisterUser(new FakeUserRepository()));
    const event = { body: '{not json' } as unknown as APIGatewayProxyEvent;

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
  });

  it('returns 500 when the repository fails with a non-domain error', async () => {
    const handler = buildCreateUser(new RegisterUser(throwingRepo()));

    const response = await handler(postEvent({ name: 'Ana', email: 'ana@example.com' }));

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe('Error');
  });

  it('ignores a password field in the payload (R1: no password accepted or stored)', async () => {
    const repo = new FakeUserRepository();
    const handler = buildCreateUser(new RegisterUser(repo));

    const response = await handler(
      postEvent({ name: 'Ana', email: 'ana@example.com', password: 'sup3rsecret' })
    );

    expect(response.statusCode).toBe(201);
    // Only the user shape is returned — the password is never read or persisted.
    expect(JSON.parse(response.body)).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      position: 'Employee',
    });
  });
});

describe('listUsers handler (GET /api/users)', () => {
  it('returns 200 with an empty array when the registry is empty (r2 empty registry)', async () => {
    const handler = buildListUsers(new ListUsers(new FakeUserRepository()));

    const response = await handler();

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([]);
  });

  it('returns 200 with all users in creation order (r2 listing)', async () => {
    const repo = new FakeUserRepository().seed(
      User.create({ name: 'Ana', email: 'ana@example.com' }),
      User.create({ name: 'Bob', email: 'bob@example.com', position: 'Manager' })
    );
    const handler = buildListUsers(new ListUsers(repo));

    const response = await handler();

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([
      { name: 'Ana', email: 'ana@example.com', position: 'Employee' },
      { name: 'Bob', email: 'bob@example.com', position: 'Manager' },
    ]);
  });

  it('returns 500 when the repository fails with a non-domain error', async () => {
    const handler = buildListUsers(new ListUsers(throwingRepo()));

    const response = await handler();

    expect(response.statusCode).toBe(500);
  });
});