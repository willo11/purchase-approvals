import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { RequestDetail } from '../../../src/domain/PurchaseRequest';
import { buildDownload } from '../../../src/api/handlers/evidence';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeEvidenceStore } from '../helpers/fakeEvidenceStore';

function getEvent(id: string): APIGatewayProxyEvent {
  return { pathParameters: { id } } as unknown as APIGatewayProxyEvent;
}

/** Real PDF-ish bytes: the download endpoint must return them verbatim. */
const PDF_BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]); // "%PDF-1.4\n"

function completedDetail(overrides: Partial<RequestDetail> = {}): RequestDetail {
  return {
    id: 'req-1',
    title: 'New laptop',
    description: 'Work machine',
    amount: 1200.5,
    currency: 'USD',
    status: 'COMPLETED',
    createdBy: { email: 'ana@example.com', name: 'Ana' },
    approvers: [
      { email: 'bob@example.com', name: 'Bob', status: 'SIGNED', locked: false, signedAt: '2026-08-14T09:00:00.000Z' },
      { email: 'carol@example.com', name: 'Carol', status: 'SIGNED', locked: false, signedAt: '2026-08-14T09:00:00.000Z' },
      { email: 'dave@example.com', name: 'Dave', status: 'SIGNED', locked: false, signedAt: '2026-08-14T09:00:00.000Z' },
    ],
    createdAt: '2026-08-14T00:00:00.000Z',
    evidenceKey: 'reqs/req-1/evidence.pdf',
    ...overrides,
  };
}

function build() {
  const requests = new FakeRequestRepository();
  const store = new FakeEvidenceStore();
  const download = buildDownload(requests, store);
  return { requests, store, download };
}

describe('GET /api/purchase-requests/{id}/evidence.pdf (#6, spec R3/R4)', () => {
  it('returns 200 application/pdf with the stored bytes when the request is COMPLETED', async () => {
    const { requests, store, download } = build();
    requests.seedDetail(completedDetail());
    store.objects.set('reqs/req-1/evidence.pdf', PDF_BYTES);

    const res = await download(getEvent('req-1'));

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('application/pdf');
    expect(res.isBase64Encoded).toBe(true);
    expect(Buffer.from(res.body, 'base64')).toEqual(Buffer.from(PDF_BYTES));
  });

  it('returns 404 when the request does not exist', async () => {
    const { download } = build();

    const res = await download(getEvent('missing'));

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 while the request is still PENDING (not completed)', async () => {
    const { requests, download } = build();
    requests.seedDetail(completedDetail({ status: 'PENDING' }));

    const res = await download(getEvent('req-1'));

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a REJECTED request', async () => {
    const { requests, download } = build();
    requests.seedDetail(completedDetail({ status: 'REJECTED' }));

    const res = await download(getEvent('req-1'));

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when COMPLETED but no evidenceKey was recorded (generation failed, R4)', async () => {
    const { requests, download } = build();
    requests.seedDetail(completedDetail({ evidenceKey: undefined }));

    const res = await download(getEvent('req-1'));

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the stored object is missing even though evidenceKey is recorded', async () => {
    const { requests, download } = build();
    requests.seedDetail(completedDetail()); // evidenceKey present, but store empty

    const res = await download(getEvent('req-1'));

    expect(res.statusCode).toBe(404);
  });
});
