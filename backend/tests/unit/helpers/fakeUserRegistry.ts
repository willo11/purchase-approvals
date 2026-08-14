import {
  RegistryUser,
  UserRegistryPort,
} from '../../../src/application/ports/UserRegistryPort';

/**
 * In-memory fake for the {@link UserRegistryPort}.
 *
 * Lets unit tests drive CreateRequest without AWS: seed registered users and
 * observe resolution calls.
 */
export class FakeUserRegistry implements UserRegistryPort {
  private users: RegistryUser[] = [];
  findByEmailCalls = 0;

  seed(...users: RegistryUser[]): this {
    this.users.push(...users);
    return this;
  }

  clear(): this {
    this.users = [];
    return this;
  }

  async findByEmail(email: string): Promise<RegistryUser | undefined> {
    this.findByEmailCalls += 1;
    return this.users.find((u) => u.email === email);
  }
}