import { User } from '../../domain/User';
import { UserAlreadyExistsError } from '../../domain/errors';

/**
 * Persistence contract for the user-registry core.
 *
 * This is the port side of the hexagonal boundary (design Decision 8): the
 * application depends on this interface, never on AWS. The DynamoDB adapter
 * implements it in `infrastructure/`.
 *
 * `save` MUST NOT overwrite an existing registration — a collision raises
 * {@link UserAlreadyExistsError} so no duplicate user is ever persisted.
 */
export interface UserRepository {
  /** Persists a new User keyed by email. Throws on a duplicate email. */
  save(user: User): Promise<void>;

  /** Returns all registered users ordered by registration (oldest first). */
  listAll(): Promise<User[]>;
}