import { Badge } from '@/components/ui/badge';

const VARIANT_BY_STATUS = {
  PENDING: 'secondary',
  SIGNED: 'default',
  REJECTED: 'destructive',
  COMPLETED: 'outline',
};

/**
 * Colored status badge for global + approver statuses.
 * Colors: Pending → neutral, Signed/Completed → solid, Rejected → destructive.
 */
export default function StatusBadge({ status, children }) {
  return (
    <Badge variant={VARIANT_BY_STATUS[status] ?? 'secondary'} data-testid="status-badge">
      {children}
    </Badge>
  );
}
