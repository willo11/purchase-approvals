/**
 * DTO → component-shape mappers for the HOST (demo hub + approver console).
 * Backend sends RequestSummary/RequestDetail/ApproverView; the console
 * consumes display-friendly views. Mapping is pure — the backend remains the
 * source of truth. Same conventions as the requester remote's mappers.
 */

/** Global + approver status → English UI labels (English UI copy contract). */
export const STATUS_LABELS = {
  PENDING: 'Pending',
  SIGNED: 'Signed',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
};

/** "USD 1,234.56" */
export function formatAmount(amount, currency = 'USD') {
  return `${currency} ${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** RequestSummary DTO → { id, title, amountLabel, statusLabel } */
export function toSummaryView(summary) {
  return {
    id: summary.id,
    title: summary.title,
    amountLabel: formatAmount(summary.amount, summary.currency),
    status: summary.status,
    statusLabel: STATUS_LABELS[summary.status] ?? summary.status,
  };
}

/** ApproverView DTO → { email, name, statusLabel } */
export function toApproverView(approver) {
  return {
    email: approver.email,
    name: approver.name,
    status: approver.status,
    statusLabel: STATUS_LABELS[approver.status] ?? approver.status,
  };
}

/** RequestDetail DTO → component shape with mapped approvers. */
export function toDetailView(detail) {
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description,
    amountLabel: formatAmount(detail.amount, detail.currency),
    status: detail.status,
    statusLabel: STATUS_LABELS[detail.status] ?? detail.status,
    approvers: (detail.approvers || []).map(toApproverView),
  };
}