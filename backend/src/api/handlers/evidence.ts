import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GlobalStatus } from '../../domain/enums/GlobalStatus';
import type { RequestRepository } from '../../application/ports/RequestRepository';
import type { EvidenceStorePort } from '../../application/ports/EvidenceStorePort';
import { makeRequestRepository } from '../../infrastructure/DynamoDbRequestRepository';
import { makeEvidenceStore } from '../../infrastructure/S3EvidenceStore';

/**
 * Error → HTTP mapper for the evidence endpoint (#6, spec R3/R4):
 *
 *   Request does not exist                    → 404
 *   Request not COMPLETED                     → 404
 *   No evidenceKey recorded                   → 404 (generation never succeeded)
 *   Stored object missing                     → 404 (deleted/never uploaded)
 *   Anything unexpected                       → 500
 *
 * A stored PDF returns 200 `application/pdf` with the raw bytes (binary body,
 * base64-encoded for API Gateway).
 */
function notFound(): APIGatewayProxyResult {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: 'EvidenceNotFoundError',
      message: 'No evidence PDF exists for this request',
    }),
  };
}

export function buildDownload(requests: RequestRepository, store: EvidenceStorePort) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const id = event.pathParameters?.id ?? '';
    try {
      const detail = await requests.get(id);
      // R3: 404 when the request does not exist OR no PDF has been generated
      // (not completed / generation failed → no evidenceKey recorded, R4).
      if (!detail || detail.status !== GlobalStatus.COMPLETED || !detail.evidenceKey) {
        return notFound();
      }
      const bytes = await store.get(detail.evidenceKey);
      if (!bytes) return notFound();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="evidence-${id}.pdf"`,
        },
        body: Buffer.from(bytes).toString('base64'),
        isBase64Encoded: true,
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: (err as Error)?.name ?? 'Error',
          message: (err as Error)?.message ?? 'Unexpected error',
        }),
      };
    }
  };
}

/**
 * Production Lambda handler (design-api serverless.yml mapping):
 *   GET /api/purchase-requests/{id}/evidence.pdf  → download (#6)
 */
const requests = makeRequestRepository();
const evidenceStore = makeEvidenceStore();

export const download = buildDownload(requests, evidenceStore);
