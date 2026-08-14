import { User } from '../domain/User';
import { UserRepository } from './ports/UserRepository';

/**
 * List registered employees use case (spec R2).
 *
 * Returns all users in registration (creation) order via the repository port.
 * Pure application logic — no framework or AWS dependencies.
 */
export class ListUsers {
  constructor(private readonly repository: UserRepository) {}

  async execute(): Promise<User[]> {
    return this.repository.listAll();
  }
}