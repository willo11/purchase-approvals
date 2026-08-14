import { InvalidAmountError } from '../errors';

/** ISO 4217 currency code used by every purchase request (design R1, USD). */
export const CURRENCY_USD = 'USD';

/**
 * Amount value object (design-api `RequestShape`).
 *
 * Owns its invariant: an `Amount` can only be constructed with a positive
 * finite number that has no more than two decimal places. The currency is
 * always `USD`. Zero framework dependencies.
 *
 * NOTE: amounts are stored as a number today; switching to integer cents
 * later is a documented, non-breaking follow-up (design open question).
 */
export class Amount {
  private constructor(private readonly value: number) {}

  /** Builds an Amount, throwing {@link InvalidAmountError} when invalid. */
  static create(raw: unknown): Amount {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new InvalidAmountError(
        `Amount must be a positive number, received: ${String(raw)}`
      );
    }
    if (!Amount.hasAtMostTwoDecimals(raw)) {
      throw new InvalidAmountError(
        `Amount must have at most 2 decimal places, received: ${raw}`
      );
    }
    return new Amount(raw);
  }

  private static hasAtMostTwoDecimals(value: number): boolean {
    const rounded = Math.round(value * 100);
    return Math.abs(value * 100 - rounded) < 1e-9;
  }

  getValue(): number {
    return this.value;
  }

  getCurrency(): string {
    return CURRENCY_USD;
  }
}