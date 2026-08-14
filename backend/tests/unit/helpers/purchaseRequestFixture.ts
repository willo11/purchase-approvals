import { CreateRequestInput } from '../../../src/domain/PurchaseRequest';

/** Returns a valid CreateRequest payload for the purchase-request use case. */
export function validCreateInput(): CreateRequestInput {
  return {
    title: 'New laptop',
    description: 'Work machine for the team',
    amount: 1200.5,
    requesterEmail: 'ana@example.com',
    approverEmails: ['bob@example.com', 'carol@example.com', 'dave@example.com'],
  };
}

/** Three registered approvers plus the requester, as registry users. */
export const registeredUsers = [
  { email: 'ana@example.com', name: 'Ana' },
  { email: 'bob@example.com', name: 'Bob' },
  { email: 'carol@example.com', name: 'Carol' },
  { email: 'dave@example.com', name: 'Dave' },
];