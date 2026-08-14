import { ListUsers } from '../../../src/application/ListUsers';
import { FakeUserRepository } from '../helpers/fakeUserRepository';
import { User } from '../../../src/domain/User';

describe('ListUsers use case', () => {
  it('returns an empty array when the registry is empty', async () => {
    const repo = new FakeUserRepository();
    const useCase = new ListUsers(repo);

    const users = await useCase.execute();

    expect(users).toEqual([]);
    expect(repo.listCalls).toBe(1);
  });

  it('returns registered users in creation order', async () => {
    const repo = new FakeUserRepository()
      .seed(
        User.create({ name: 'Ana', email: 'ana@example.com' }),
        User.create({ name: 'Bob', email: 'bob@example.com' })
      );
    const useCase = new ListUsers(repo);

    const users = await useCase.execute();

    expect(users.map((u) => u.getName())).toEqual(['Ana', 'Bob']);
    expect(users.map((u) => u.getEmail().toString())).toEqual([
      'ana@example.com',
      'bob@example.com',
    ]);
  });
});