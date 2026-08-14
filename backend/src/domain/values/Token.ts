import { randomUUID } from 'node:crypto';

/**
 * A URL-safe per-approver approval token (spec R1).
 *
 * `randomUUID()` produces hex digits and hyphens, which are safe unescaped in
 * a URL query, so it satisfies the "unique, URL-safe UUID" requirement without
 * extra encoding. Value object — validated by construction. Zero framework
 * dependencies.
 */
export class Token {
  private constructor(private readonly value: string) {}

  /** Generates a fresh unique URL-safe token. */
  static urlSafe(): Token {
    return new Token(randomUUID());
  }

  /** Rehydrates an existing token value (e.g. when resolving a link). */
  static fromString(value: string): Token {
    return new Token(value);
  }

  equals(other: Token): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}