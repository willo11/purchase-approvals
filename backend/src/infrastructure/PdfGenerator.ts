import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { RequestDetail } from '../domain/PurchaseRequest';
import type { EvidenceGeneratorPort } from '../application/ports/EvidenceGeneratorPort';

/**
 * Real {@link EvidenceGeneratorPort} (task 5.1, DECISIONS #7/#23): renders the
 * evidence PDF with pdf-lib + `StandardFonts.Helvetica` — pure TypeScript with
 * ZERO native dependencies, so it runs safely inside the Lambda runtime.
 *
 * Content per spec R1: request title/description/amount/date, "Requester"
 * resolved from the `createdBy.name` snapshot (never re-fetched from the
 * registry), and a signature section with EXACTLY 3 rows — one per approver —
 * each showing the approver's REGISTERED snapshot name and their signature
 * timestamp (status derived from whichever of signedAt/rejectedAt is present;
 * pending rows show a dash). No typed name ever reaches the PDF.
 */
export class PdfGenerator implements EvidenceGeneratorPort {
  async generate(request: RequestDetail): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    // US Letter portrait; margins on x=56, top y=740 and flowing down.
    const page = pdf.addPage([612, 792]);
    const black = rgb(0, 0, 0);
    const gray = rgb(0.35, 0.35, 0.35);

    let y = 740;
    const line = (text: string, size = 12, color = black, gap = 26): void => {
      page.drawText(text, { x: 56, y, size, font, color });
      y -= gap;
    };

    // R1 — request data block: title, description, amount, date.
    line(request.title, 18, black, 38);
    line(`Description: ${request.description}`, 11, gray);
    line(`Amount: ${request.currency} ${request.amount.toFixed(2)}`);
    line(`Date: ${request.createdAt}`);
    // R1 — "Requester" from the createdBy.name snapshot.
    line(`Requester: ${request.createdBy.name}`);
    y -= 10;

    // R1 — signature section: exactly 3 rows, one per approver. The name is the
    // REGISTERED snapshot; the timestamp comes from the durable signature
    // record (signedAt/rejectedAt), or a dash while the approver is PENDING.
    line('Signatures:', 13, black, 28);
    request.approvers.forEach((approver, index) => {
      const timestamp = approver.signedAt ?? approver.rejectedAt ?? '—';
      line(
        `${index + 1}. ${approver.name} — ${approver.status} — ${timestamp}`,
        11,
        gray
      );
    });

    return pdf.save();
  }
}
