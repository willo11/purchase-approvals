import { User } from '../../../src/domain/User';
import { UserAlreadyExistsError } from '../../../src/domain/errors';
import { UserRepository } from '../../../src/application/ports/UserRepository';

/**
 * In-memory, fluent fake for the {@link UserRepository} port.
 *
 * Lets unit tests drive the use cases and handlers without AWS: seed users,
 * toggle duplicate rejection, and observe call counts. `save` refuses a
 * duplicate email exactly like the real adapter's conditional PutItem.
 */
export class FakeUserRepository implements UserRepository {
  private users: User[] = [];
  private rejectDuplicates = true;

  saveCalls = 0;
  listCalls = 0;

  /** Enables/disables duplicate rejection. Returns `this` for chaining. */
  withDuplicates(reject: boolean): this {
    this.rejectDuplicates = reject;
    return this;
  }

  /** Seeds pre-existing users. Returns `this` for chaining. */
  seed(...users: User[]): this {
    this.users.push(...users);
    return this;
  }

  count(): number {
    return this.users.length;
  }

  async save(user: User): Promise<void> {
    this.saveCalls += 1;
    const duplicate = this.users.some((u) => u.getEmail().equals(user.getEmail()));
    if (duplicate && this.rejectDuplicates) {
      throw new UserAlreadyExistsError('email already registered');
    }
    this.users.push(user);
  }

  async listAll(): Promise<User[]> {
    this.listCalls += 1;
    return [...this.users];
  }
}