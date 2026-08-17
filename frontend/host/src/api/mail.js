import { apiClient } from './client';

/**
 * Mock-mail API — the demo inbox (backend `GET /mock-mail`).
 * Approver console usage: `listMail(to)` returns one recipient's mails
 * (APPROVAL_LINK + OTP, newest first) so it can resolve the real approval
 * link for a request.
 */

/**
 * GET /mock-mail?to=<email> → MailEvent[] restricted to one recipient;
 * without `to`, the full log (newest first). MailEvent:
 * { id, to, type: 'APPROVAL_LINK'|'OTP', subject, body, link?, otpPlain?,
 *   createdAt }.
 */
export async function listMail(to) {
  const { data } = await apiClient.get('/mock-mail', {
    params: to ? { to } : undefined,
  });
  return data;
}

/**
 * Finds the APPROVAL_LINK mail for a request inside a mail list and returns
 * its real `link` (or null). The link shape is
 * `https://<host>/approve?request_id=<id>&approver_token=<uuid>` — we compare
 * the parsed `request_id` so the result is independent of which origin the
 * mail was built for (local host vs deployed host). Pure helper, unit-tested.
 */
export function findApprovalLinkFor(mails, requestId) {
  const match = (mails || []).find((mail) => {
    if (!mail || typeof mail.link !== 'string') return false;
    try {
      return new URL(mail.link).searchParams.get('request_id') === requestId;
    } catch {
      return false; // malformed URL — never a candidate
    }
  });
  return match ? match.link : null;
}