/**
 * Colored status badge for global + approver statuses (host demo console).
 *
 * Replicates the exact color language of the requester's StatusBadge / shadcn
 * Badge variants so "Signed" reads green/solid, "Pending" neutral, "Rejected"
 * destructive, "Completed" outline — making it obvious who approved and who
 * didn't at a glance. Self-contained (no cva dep): the host has the theme CSS
 * vars in app/globals.css but not the full shadcn UI kit.
 */
const VARIANT_BY_STATUS = {
  PENDING: 'border-transparent bg-secondary text-secondary-foreground',
  SIGNED: 'border-transparent bg-primary text-primary-foreground',
  REJECTED: 'border-transparent bg-destructive text-destructive-foreground',
  COMPLETED: 'text-foreground',
};

export default function StatusBadge({ status, children }) {
  const color = VARIANT_BY_STATUS[status] ?? VARIANT_BY_STATUS.PENDING;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {children}
    </span>
  );
}
