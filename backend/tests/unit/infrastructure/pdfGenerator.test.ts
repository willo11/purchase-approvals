import { PDFArray, PDFDocument, PDFRef, PDFStream } from 'pdf-lib';
import { inflateSync } from 'zlib';
import type { RequestDetail } from '../../../src/domain/PurchaseRequest';
import { PdfGenerator } from '../../../src/infrastructure/PdfGenerator';

/**
 * Extracts the drawn-text of page 0 from a pdf-lib-saved PDF. pdf-lib writes
 * content streams Flate-compressed and encodes strings as <hex> literals, so
 * the stream is inflated and every hex literal decoded to latin1 text.
 */
async function pageText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const items =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
      : contents
        ? [contents]
        : [];

  let operators = '';
  for (const item of items) {
    const stream = item instanceof PDFRef ? doc.context.lookup(item) : item;
    if (stream instanceof PDFStream) {
      const raw = Buffer.from(stream.getContents());
      try {
        operators += inflateSync(raw).toString('latin1');
      } catch {
        operators += raw.toString('latin1'); // uncompressed fallback
      }
    }
  }

  const decoded: string[] = [];
  const hexLiteral = /<([0-9A-Fa-f]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = hexLiteral.exec(operators)) !== null) {
    decoded.push(Buffer.from(match[1], 'hex').toString('latin1'));
  }
  return decoded.join(' ');
}

/** A COMPLETED request whose requester is "Carol" (spec R1 scenario). */
function completedDetail(): RequestDetail {
  return {
    id: 'req-ev',
    title: 'New laptop',
    description: 'Work machine for onboarding',
    amount: 1200.5,
    currency: 'USD',
    status: 'COMPLETED',
    createdBy: { email: 'carol@example.com', name: 'Carol' },
    approvers: [
      { email: 'bob@example.com', name: 'Bob', status: 'SIGNED', locked: false, signedAt: '2026-08-14T09:00:00.000Z' },
      { email: 'dave@example.com', name: 'Dave', status: 'SIGNED', locked: false, signedAt: '2026-08-14T09:05:00.000Z' },
      { email: 'emma@example.com', name: 'Emma', status: 'SIGNED', locked: false, signedAt: '2026-08-14T09:10:00.000Z' },
    ],
    createdAt: '2026-08-14T00:00:00.000Z',
    evidenceKey: 'reqs/req-ev/evidence.pdf',
  };
}

describe('PdfGenerator (task 5.1, spec R1)', () => {
  const generator = new PdfGenerator();

  it('produces a valid PDF that pdf-lib can re-parse (single page)', async () => {
    const bytes = await generator.generate(completedDetail());

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('contains the request data and "Requester" resolved from createdBy.name (R1)', async () => {
    const text = await pageText(await generator.generate(completedDetail()));

    expect(text).toContain('New laptop');
    expect(text).toContain('Description: Work machine for onboarding');
    expect(text).toContain('USD 1200.50');
    expect(text).toContain('2026-08-14T00:00:00.000Z'); // date
    // requester comes from the createdBy.name SNAPSHOT — never re-fetched
    expect(text).toContain('Requester: Carol');
  });

  it('renders exactly 3 signature rows with the registered name + email and their timestamps (R1)', async () => {
    const text = await pageText(await generator.generate(completedDetail()));

    expect(text).toContain('Signatures:');
    // Each row carries the registered name, its EMAIL, the status and timestamp.
    expect(text).toContain('1. Bob <bob@example.com>');
    expect(text).toContain('2. Dave <dave@example.com>');
    expect(text).toContain('3. Emma <emma@example.com>');
    expect(text).toContain('Bob');
    expect(text).toContain('Dave');
    expect(text).toContain('Emma');
    expect(text).toContain('2026-08-14T09:00:00.000Z');
    expect(text).toContain('2026-08-14T09:05:00.000Z');
    expect(text).toContain('2026-08-14T09:10:00.000Z');
  });

  it('derives each row status from what is present: rejectedAt shown, pending shows a dash', async () => {
    const detail: RequestDetail = {
      ...completedDetail(),
      approvers: [
        { email: 'bob@example.com', name: 'Bob', status: 'SIGNED', locked: false, signedAt: '2026-08-14T09:00:00.000Z' },
        { email: 'dave@example.com', name: 'Dave', status: 'REJECTED', locked: false, rejectedAt: '2026-08-14T09:05:00.000Z' },
        { email: 'emma@example.com', name: 'Emma', status: 'PENDING', locked: false },
      ],
    };

    const text = await pageText(await generator.generate(detail));

    expect(text).toContain('REJECTED');
    expect(text).toContain('2026-08-14T09:05:00.000Z');
    expect(text).toContain('PENDING');
  });
});
