import { User } from '../domain/User';
import { UserRepository } from './ports/UserRepository';

export interface RegisterUserCommand {
  name: unknown;
  email: unknown;
  position?: unknown;
}

/**
 * Register an employee use case (spec R1).
 *
 * Creates a validated {@link User} (empty name / invalid email raise domain
 * errors → HTTP 400) and persists it against the email natural key via the
 * repository port. A duplicate email surfaces from the repository as
 * {@link UserAlreadyExistsError} → HTTP 409; the port guarantees no overwrite.
 *
 * Pure application logic — no framework or AWS dependencies.
 */
export class RegisterUser {
  constructor(private readonly repository: UserRepository) {}

  async execute(command: RegisterUserCommand): Promise<User> {
    const user = User.create({
      name: command.name,
      email: command.email,
      position: command.position,
    });
    await this.repository.save(user);
    return user;
  }
}