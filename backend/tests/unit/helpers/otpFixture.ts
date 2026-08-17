import type { RequestDetail } from '../../../src/domain/PurchaseRequest';

/**
 * Builds a RequestDetail for gate tests. Defaults to a PENDING request owned
 * by ana with bob as one approver (gate resolves bob by token).
 */
export function otpRequestDetail(overrides: Partial<RequestDetail> = {}): RequestDetail {
  return {
    id: 'req-1',
    title: 'New laptop',
    description: 'Work machine',
    amount: 1200.5,
    currency: 'USD',
    status: 'PENDING',
    createdBy: { email: 'ana@example.com', name: 'Ana' },
    approvers: [
      { email: 'bob@example.com', name: 'Bob', status: 'PENDING', locked: false },
      { email: 'carol@example.com', name: 'Carol', status: 'PENDING', locked: false },
      { email: 'dave@example.com', name: 'Dave', status: 'PENDING', locked: false },
    ],
    createdAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

/** An ACTIVE durable approver gate state owned by bob, token ACTIVE. */
export function activeGate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    email: 'bob@example.com',
    name: 'Bob',
    token: 'token-bob',
    tokenStatus: 'ACTIVE' as const,
    attempts: 0,
    ...overrides,
  };
}