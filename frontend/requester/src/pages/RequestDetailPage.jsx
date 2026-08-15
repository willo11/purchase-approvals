import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { downloadEvidence, getRequest } from '@/api/requests';
import { toDetailView } from '@/api/mappers';
import { toErrorView } from '@/api/client';
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
 * R3 + R4: request metadata + per-approver status table; "Download PDF"
 * button ONLY when the global status is COMPLETED (blob GET #6).
 */
export default function RequestDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setDetail(null);
    try {
      const data = await getRequest(id);
      setDetail(toDetailView(data));
    } catch (err) {
      setError(toErrorView(err));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownloadPdf = async () => {
    setDownloadError(null);
    setDownloading(true);
    try {
      const blob = await downloadEvidence(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `evidence-${id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(toErrorView(err));
    } finally {
      setDownloading(false);
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <p>{error.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={load}>
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return <p>Loading request...</p>;
  }

  const completed = detail.status === 'COMPLETED';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>{detail.title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {detail.description}
            </p>
          </div>
          <StatusBadge status={detail.status}>{detail.statusLabel}</StatusBadge>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-medium">{detail.amountLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Requester</dt>
              <dd className="font-medium">{detail.requester.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium">{detail.createdLabel}</dd>
            </div>
          </dl>

          {completed && (
            <div className="mt-4">
              <Button onClick={handleDownloadPdf} disabled={downloading}>
                {downloading ? 'Downloading...' : 'Download PDF'}
              </Button>
              {downloadError && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {downloadError.message}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approvals</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Signed / Rejected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.approvers.map((a) => (
                <TableRow key={a.email}>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>{a.email}</TableCell>
                  <TableCell>
                    <StatusBadge status={a.status}>{a.statusLabel}</StatusBadge>
                  </TableCell>
                  <TableCell>{a.actionLabel}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => navigate('..')}>
        Back to list
      </Button>
    </div>
  );
}
