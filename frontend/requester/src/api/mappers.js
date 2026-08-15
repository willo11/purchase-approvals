/**
 * DTO → component-shape mappers. Backend sends snake-ish camel shapes
 * (RequestSummary/RequestDetail/ApproverView/User); components consume a
 * display-friendly view (labels, formatted amounts/dates). Mapping is pure —
 * the backend remains the source of truth.
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

/** RequestSummary DTO → { id, title, amountLabel, statusLabel, createdLabel } */
export function toSummaryView(summary) {
  return {
    id: summary.id,
    title: summary.title,
    amountLabel: formatAmount(summary.amount, summary.currency),
    status: summary.status,
    statusLabel: STATUS_LABELS[summary.status] ?? summary.status,
    createdLabel: formatDate(summary.createdAt),
    createdAt: summary.createdAt,
  };
}

/** ApproverView DTO → { email, name, statusLabel, actionLabel } */
export function toApproverView(approver) {
  const actedAt = approver.signedAt || approver.rejectedAt;
  return {
    email: approver.email,
    name: approver.name,
    status: approver.status,
    statusLabel: STATUS_LABELS[approver.status] ?? approver.status,
    actionLabel: actedAt ? formatDate(actedAt) : '—',
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
    requester: detail.createdBy,
    approvers: (detail.approvers || []).map(toApproverView),
    createdLabel: formatDate(detail.createdAt),
    evidenceKey: detail.evidenceKey,
  };
}

/** User DTO → { value, label } for shadcn Select options. */
export function toUserOption(user) {
  return { value: user.email, label: `${user.name} (${user.email})` };
}
