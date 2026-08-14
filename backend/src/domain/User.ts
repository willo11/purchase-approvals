import { Email } from './values/Email';
import { EmptyNameError } from './errors';

/**
 * Default value applied to `cargo` when a registration omits it (spec R1,
 * scenario "Cargo optional"). The registry is Spanish-domain, so the neutral
 * default reads as a generic job position ("Employee").
 */
export const DEFAULT_CARGO = 'Empleado';

/** Plain shape of a User, used at the API boundary and in storage. */
export interface UserPrimitives {
  name: string;
  email: string;
  cargo: string;
}

export interface CreateUserInput {
  name: unknown;
  email: unknown;
  cargo?: unknown;
}

/**
 * User aggregate — a registered company employee.
 *
 * `email` is the natural key (`USER#<email>` in the single table). `cargo` is
 * an optional job position that defaults to {@link DEFAULT_CARGO}. Role
 * (requester/approver) is positional and never stored on the User (design
 * Decision 9). No password — email-only demo identity (Decision 10).
 *
 * Zero framework dependencies.
 */
export class User {
  private constructor(
    private readonly name: string,
    private readonly email: Email,
    private readonly cargo: string
  ) {}

  /** Builds a validated User, applying the cargo default when omitted. */
  static create(input: CreateUserInput): User {
    const name = User.validateName(input.name);
    const email = Email.create(input.email);
    const cargo = User.toCargo(input.cargo);
    return new User(name, email, cargo);
  }

  private static validateName(raw: unknown): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new EmptyNameError('Name must be a non-empty string');
    }
    return raw.trim();
  }

  private static toCargo(raw: unknown): string {
    if (raw === undefined || raw === null) {
      return DEFAULT_CARGO;
    }
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return DEFAULT_CARGO;
    }
    return raw.trim();
  }

  getName(): string {
    return this.name;
  }

  getEmail(): Email {
    return this.email;
  }

  getCargo(): string {
    return this.cargo;
  }

  toPrimitives(): UserPrimitives {
    return {
      name: this.name,
      email: this.email.toString(),
      cargo: this.cargo,
    };
  }
}