import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRequests } from '@/api/requests';
import { toSummaryView } from '@/api/mappers';
import { toErrorView } from '@/api/client';
import { useRequestStore } from '@/store/useRequestStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import StatusBadge from '@/components/StatusBadge';

/**
 * R1 + R5: list of requests, newest first, with empty state and error
 * surfacing that keeps the screen usable.
 */
export default function RequestListPage() {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);
  const refreshSignal = useRequestStore((s) => s.listRefreshSignal);

  const load = useCallback(async () => {
    setError(null);
    setRequests(null);
    try {
      const summaries = await listRequests();
      // Backend already returns newest-first (GSI1); keep the order verbatim.
      setRequests(summaries.map(toSummaryView));
    } catch (err) {
      setError(toErrorView(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Purchase requests</CardTitle>
        <Button asChild size="sm">
          <Link to="new">New request</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <p>{error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={load}
            >
              Try again
            </Button>
          </div>
        )}

        {!error && requests === null && <p>Loading requests...</p>}

        {!error && requests !== null && requests.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-muted-foreground">
              No purchase requests yet.
            </p>
            <Button asChild className="mt-4">
              <Link to="new">Create your first request</Link>
            </Button>
          </div>
        )}

        {!error && requests !== null && requests.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link to={r.id} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                  </TableCell>
                  <TableCell>{r.amountLabel}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status}>{r.statusLabel}</StatusBadge>
                  </TableCell>
                  <TableCell>{r.createdLabel}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
