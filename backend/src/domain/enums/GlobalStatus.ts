/**
 * Global state of a purchase request (design R2).
 *
 * Precedence: `COMPLETED` > `REJECTED` > `PENDING`. `COMPLETED` and `REJECTED`
 * are terminal — no transition can leave them. Creation always starts the
 * request in `PENDING`. Zero framework dependencies.
 */
export const GlobalStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
} as const;

export type GlobalStatus = (typeof GlobalStatus)[keyof typeof GlobalStatus];