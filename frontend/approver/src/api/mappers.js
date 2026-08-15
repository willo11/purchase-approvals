/**
 * DTO → component-shape mappers for the approver flow. Backend sends
 * snake-ish camel shapes (RequestDetail/ApproverView); the decision screen
 * consumes a display-friendly view (labels, formatted amounts/dates).
 * Mapping is pure — the backend remains the source of truth.
 */

/** Global + approver status → English UI labels (English UI copy contract). */
export const STATUS_LABELS = {
  PENDING: 'Pending',
  SIGNED: 'Signed',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
};

/** Deterministic date label (UTC, e.g. "Aug 14, 2026"). */
export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** "USD 1,234.56" */
export function formatAmount(amount, currency = 'USD') {
  return `${currency} ${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** RequestDetail DTO → decision-screen shape (R3: title/description/amount/requester). */
export function toDetailView(detail) {
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description,
    amountLabel: formatAmount(detail.amount, detail.currency),
    status: detail.status,
    statusLabel: STATUS_LABELS[detail.status] ?? detail.status,
    requester: detail.createdBy?.name ?? '—',
    createdLabel: formatDate(detail.createdAt),
  };
}
