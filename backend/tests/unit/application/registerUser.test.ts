import { RegisterUser } from '../../../src/application/RegisterUser';
import { FakeUserRepository } from '../helpers/fakeUserRepository';
import { InvalidEmailError, EmptyNameError, UserAlreadyExistsError } from '../../../src/domain/errors';

describe('RegisterUser use case', () => {
  it('registers a valid user and persists it', async () => {
    const repo = new FakeUserRepository();
    const useCase = new RegisterUser(repo);

    const user = await useCase.execute({
      name: 'Ana',
      email: 'ana@example.com',
      cargo: 'Contadora',
    });

    expect(user.toPrimitives()).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      cargo: 'Contadora',
    });
    expect(repo.count()).toBe(1);
    expect(repo.saveCalls).toBe(1);
  });

  it('applies the default cargo when omitted', async () => {
    const useCase = new RegisterUser(new FakeUserRepository());
    const user = await useCase.execute({ name: 'Ana', email: 'ana@example.com' });
    expect(user.getCargo()).toBe('Empleado');
  });

  it('rejects an empty name', async () => {
    await expect(
      new RegisterUser(new FakeUserRepository()).execute({ name: '', email: 'ana@example.com' })
    ).rejects.toThrow(EmptyNameError);
  });

  it('rejects an invalid email format', async () => {
    await expect(
      new RegisterUser(new FakeUserRepository()).execute({ name: 'Ana', email: 'bad' })
    ).rejects.toThrow(InvalidEmailError);
  });

  it('surfaces a duplicate email as UserAlreadyExistsError and does not persist', async () => {
    const repo = new FakeUserRepository();
    const useCase = new RegisterUser(repo);

    await useCase.execute({ name: 'Ana', email: 'ana@example.com' });
    await expect(
      useCase.execute({ name: 'Ana Dupe', email: 'ana@example.com' })
    ).rejects.toThrow(UserAlreadyExistsError);

    expect(repo.count()).toBe(1); // no duplicate persisted
    expect(repo.saveCalls).toBe(2); // the second write was refused
  });
});