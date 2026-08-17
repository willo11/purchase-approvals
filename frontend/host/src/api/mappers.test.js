import {
  STATUS_LABELS,
  formatAmount,
  toApproverView,
  toDetailView,
  toSummaryView,
} from './mappers';

describe('STATUS_LABELS (English UI copy contract)', () => {
  test('covers every backend status', () => {
    expect(STATUS_LABELS).toEqual({
      PENDING: 'Pending',
      SIGNED: 'Signed',
      REJECTED: 'Rejected',
      COMPLETED: 'Completed',
    });
  });
});

describe('formatAmount', () => {
  test('formats as USD with 2 decimals', () => {
    expect(formatAmount(1234.5)).toBe('USD 1,234.50');
  });
});

describe('toSummaryView', () => {
  test('maps a RequestSummary to the card shape', () => {
    const view = toSummaryView({
      id: 'r1',
      title: 'New laptops',
      amount: 2500,
      currency: 'USD',
      status: 'PENDING',
    });
    expect(view).toEqual({
      id: 'r1',
      title: 'New laptops',
      amountLabel: 'USD 2,500.00',
      status: 'PENDING',
      statusLabel: 'Pending',
    });
  });

  test('falls back to the raw status when the label is unknown', () => {
    expect(toSummaryView({ id: 'r1', status: 'WEIRD' }).statusLabel).toBe('WEIRD');
  });
});

describe('toApproverView', () => {
  test('maps an ApproverView incl. status label', () => {
    expect(toApproverView({ email: 'a@x.com', name: 'Ana', status: 'SIGNED' })).toEqual({
      email: 'a@x.com',
      name: 'Ana',
      status: 'SIGNED',
      statusLabel: 'Signed',
    });
  });
});

describe('toDetailView', () => {
  test('maps a RequestDetail and its 3 approvers', () => {
    const detail = toDetailView({
      id: 'r1',
      title: 'Laptops',
      description: 'x',
      amount: 100,
      currency: 'USD',
      status: 'PENDING',
      approvers: [
        { email: 'a@x.com', name: 'Ana', status: 'PENDING' },
        { email: 'b@x.com', name: 'Bob', status: 'SIGNED' },
        { email: 'c@x.com', name: 'Cara', status: 'REJECTED' },
      ],
    });
    expect(detail.approvers).toHaveLength(3);
    expect(detail.approvers[1].statusLabel).toBe('Signed');
    expect(detail.amountLabel).toBe('USD 100.00');
  });

  test('handles a missing approvers list', () => {
    const detail = toDetailView({ id: 'r1', status: 'PENDING', approvers: undefined });
    expect(detail.approvers).toEqual([]);
  });
});