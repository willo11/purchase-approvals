/**
 * Per-approver status shown in the request detail view (design R4).
 *
 * Each approver record starts `PENDING`; the signature capability (PR #4)
 * moves one to `SIGNED` or `REJECTED` by writing `status_signed` /
 * `status_rejected` timestamps. Zero framework dependencies.
 */
export const ApproverStatus = {
  PENDING: 'PENDING',
  SIGNED: 'SIGNED',
  REJECTED: 'REJECTED',
} as const;

export type ApproverStatus = (typeof ApproverStatus)[keyof typeof ApproverStatus];