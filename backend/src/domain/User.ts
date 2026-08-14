import { Email } from './values/Email';
import { EmptyNameError } from './errors';

/**
 * Default value applied to `position` when a registration omits it (spec R1,
 * scenario "Position optional"). The neutral default reads as a generic job
 * position ("Employee").
 */
export const DEFAULT_POSITION = 'Employee';

/** Plain shape of a User, used at the API boundary and in storage. */
export interface UserPrimitives {
  name: string;
  email: string;
  position: string;
}

export interface CreateUserInput {
  name: unknown;
  email: unknown;
  position?: unknown;
}

/**
 * User aggregate — a registered company employee.
 *
 * `email` is the natural key (`USER#<email>` in the single table). `position`
 * is an optional job position that defaults to {@link DEFAULT_POSITION}. Role
 * (requester/approver) is positional and never stored on the User (design
 * Decision 9). No password — email-only demo identity (Decision 10).
 *
 * Zero framework dependencies.
 */
export class User {
  private constructor(
    private readonly name: string,
    private readonly email: Email,
    private readonly position: string
  ) {}

  /** Builds a validated User, applying the position default when omitted. */
  static create(input: CreateUserInput): User {
    const name = User.validateName(input.name);
    const email = Email.create(input.email);
    const position = User.toPosition(input.position);
    return new User(name, email, position);
  }

  private static validateName(raw: unknown): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new EmptyNameError('Name must be a non-empty string');
    }
    return raw.trim();
  }

  private static toPosition(raw: unknown): string {
    if (raw === undefined || raw === null) {
      return DEFAULT_POSITION;
    }
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return DEFAULT_POSITION;
    }
    return raw.trim();
  }

  getName(): string {
    return this.name;
  }

  getEmail(): Email {
    return this.email;
  }

  getPosition(): string {
    return this.position;
  }

  toPrimitives(): UserPrimitives {
    return {
      name: this.name,
      email: this.email.toString(),
      position: this.position,
    };
  }
}