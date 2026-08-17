#!/usr/bin/env node
// Demo scenario seeder — drives the REAL backend API (not direct DynamoDB
// writes) to build ready-made demo states for the local demo hub:
//
//   1. "Rejected demo"              → global REJECTED (Ana rejects after OTP)
//   2. "Completed demo"             → global COMPLETED (3 approvals + PDF)
//   3. "Pending demo (OTP regenerated)" → PENDING with 2 OTP mails for Ana
//   4. "Pending demo (fresh)"       → PENDING, untouched (drive it yourself)
//
// Requirements (documented in README + MANUAL-TESTING):
//   - the backend MUST be running (`pnpm run dev`) — we call its HTTP API
//   - the table exists + the demo cast is seeded (`pnpm run demo:setup`)
//
// Every run creates a NEW set of requests — there is NO cleanup; the demo
// grows with each run (existing requests are left untouched). Base URL comes
// from API_BASE_URL and defaults to the local serverless-offline stage.
//
// Usage:
//   pnpm -C backend run db:seed-scenarios
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000/dev';

const REQUIRES = [
  'ruth@example.com', // requester
  'ana@example.com', // approver
  'sven@example.com', // approver
  'luca@example.com', // approver
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * JSON request against the real API. Fails loudly (exit ≠ 0) on any non-2xx
 * response, echoing the backend's error payload so a broken seed is obvious.
 */
async function request(method, path, body) {
  const url = `${API_BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `Could not reach ${API_BASE_URL} (${err.message}). ` +
        'Is the backend running? Start it with `pnpm run dev`, then retry.'
    );
  }
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    const detail =
      payload && typeof payload === 'object'
        ? `${payload.error ?? ''} ${payload.message ?? ''}`.trim()
        : payload;
    throw new Error(`${method} ${path} → HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return payload;
}

/** Extracts request_id + approver_token from a mailed approval link. */
function tokenFromLink(link) {
  try {
    const url = new URL(link);
    return {
      requestId: url.searchParams.get('request_id'),
      token: url.searchParams.get('approver_token'),
    };
  } catch {
    return { requestId: null, token: null };
  }
}

/** The approver's real approval token, read from their mailed approval link. */
async function approverTokenFor(email, requestId) {
  const mails = await request('GET', `/mock-mail?to=${encodeURIComponent(email)}`);
  const linkMail = mails.find(
    (mail) => mail.type === 'APPROVAL_LINK' && tokenFromLink(mail.link).requestId === requestId
  );
  if (!linkMail) {
    throw new Error(`No approval link found for ${email} on request ${requestId}`);
  }
  const token = tokenFromLink(linkMail.link).token;
  if (!token) {
    throw new Error(`Approval link for ${email} on request ${requestId} carries no approver_token`);
  }
  return token;
}

/**
 * The LATEST OTP for one approver + request. The inbox is newest-first, so the
 * first OTP mail mentioning this requestId is the currently valid code.
 */
async function latestOtp(email, requestId) {
  const mails = await request('GET', `/mock-mail?to=${encodeURIComponent(email)}`);
  const otpMails = mails.filter(
    (mail) => mail.type === 'OTP' && mail.subject?.includes(requestId)
  );
  if (otpMails.length === 0) {
    throw new Error(`No OTP mail found for ${email} on request ${requestId}`);
  }
  return otpMails[0].otpPlain;
}

/** Issues an OTP for an approver, reads its code from mock-mail, validates it. */
async function issueOtpAndValidate(email, requestId, token) {
  await request('POST', `/api/approvals/${requestId}/token/${token}/otp`);
  console.log(`  Issued OTP for ${email}`);
  // Small pause so the new mail lands with a strictly newer createdAt — the
  // inbox is ordered by createdAt, so "latest" stays unambiguous.
  await sleep(400);
  const code = await latestOtp(email, requestId);
  console.log(`  Read OTP code from mock-mail (${email})`);
  await request('POST', `/api/approvals/${requestId}/token/${token}/otp/validate`, { code });
  console.log('  Validated OTP');
}

function signedCount(detail) {
  return detail.approvers.filter((approver) => approver.status === 'SIGNED').length;
}

/**
 * Asserts a seeded scenario reached its expected global state. Any mismatch
 * fails the whole seed (exit 1) so a broken run is caught immediately.
 */
async function assertState(id, label, expectedStatus) {
  const detail = await request('GET', `/api/purchase-requests/${id}`);
  if (detail.status !== expectedStatus) {
    throw new Error(`"${label}" expected final state ${expectedStatus}, got ${detail.status}`);
  }
  console.log(`  ✓ "${label}" final state ${detail.status}`);
}

/** Asserts the regenerated scenario left Ana with exactly 2 OTP mails. */
async function assertRegeneratedOtps(id) {
  const mails = await request('GET', `/mock-mail?to=${encodeURIComponent('ana@example.com')}`);
  const otpMails = mails.filter((m) => m.type === 'OTP' && m.subject?.includes(id));
  if (otpMails.length !== 2) {
    throw new Error(`"Pending demo (OTP regenerated)" expected 2 OTP mails for Ana, got ${otpMails.length}`);
  }
  console.log(`  ✓ "Pending demo (OTP regenerated)" has ${otpMails.length} OTP mails for Ana (newest valid)`);
}

/** Confirms a completed request's evidence PDF is downloadable (memory store). */
async function checkEvidence(requestId) {
  const res = await fetch(`${API_BASE_URL}/api/purchase-requests/${requestId}/evidence.pdf`);
  if (res.ok) {
    const bytes = await res.arrayBuffer();
    const type = res.headers.get('content-type') ?? 'application/pdf';
    console.log(`  Evidence PDF available (${type}, ${bytes.byteLength} bytes) ✓`);
  } else if (res.status === 404) {
    console.log(
      '  Evidence PDF → 404: EVIDENCE_STORE=memory was not active when the request completed ' +
        '(with the S3 store the request stays COMPLETED but the download 404s)'
    );
  } else {
    console.log(`  Evidence PDF check → HTTP ${res.status}`);
  }
}

async function seedRejected() {
  console.log('1/4 Rejected demo — Ana validates an OTP and rejects');
  const detail = await request('POST', '/api/purchase-requests', {
    title: 'Rejected demo',
    description: 'Seeded by db:seed-scenarios — Ana rejects after OTP validation.',
    amount: 1250,
    currency: 'USD',
    requesterEmail: 'ruth@example.com',
    approverEmails: ['ana@example.com', 'sven@example.com', 'luca@example.com'],
  });
  const id = detail.id;
  console.log(`  Created request ${id} "${detail.title}" (${detail.status})`);
  await sleep(300); // the three approval-link mails land before we read them

  const anaToken = await approverTokenFor('ana@example.com', id);
  await issueOtpAndValidate('ana@example.com', id, anaToken);
  const rejected = await request('POST', `/api/approvals/${id}/token/${anaToken}/reject`, { confirm: true });
  console.log(`  Rejected request (confirm: true) → global status ${rejected.status}`);
  await assertState(id, 'Rejected demo', 'REJECTED');
  console.log('  Sven + Luca links now show the terminal state (410) — nothing to act on');
}

async function seedCompleted() {
  console.log('2/4 Completed demo — all three approvers sign (OTP each)');
  const detail = await request('POST', '/api/purchase-requests', {
    title: 'Completed demo',
    description: 'Seeded by db:seed-scenarios — all three approvers sign in order.',
    amount: 4800,
    currency: 'USD',
    requesterEmail: 'ruth@example.com',
    approverEmails: ['ana@example.com', 'sven@example.com', 'luca@example.com'],
  });
  const id = detail.id;
  console.log(`  Created request ${id} "${detail.title}" (${detail.status})`);
  await sleep(300);

  let signed = 0;
  for (const email of ['ana@example.com', 'sven@example.com', 'luca@example.com']) {
    const token = await approverTokenFor(email, id);
    await issueOtpAndValidate(email, id, token);
    const updated = await request('POST', `/api/approvals/${id}/token/${token}/approve`);
    signed = signedCount(updated);
    console.log(`  Approved — ${signed}/3 signed`);
  }
  await assertState(id, 'Completed demo', 'COMPLETED');
  await checkEvidence(id);
}

async function seedRegeneratedOtp() {
  console.log('3/4 Pending demo (OTP regenerated) — Ana keeps a fresh code');
  const detail = await request('POST', '/api/purchase-requests', {
    title: 'Pending demo (OTP regenerated)',
    description: 'Seeded by db:seed-scenarios — Ana regenerated her OTP; the newest mail is valid.',
    amount: 950,
    currency: 'USD',
    requesterEmail: 'ruth@example.com',
    approverEmails: ['ana@example.com', 'sven@example.com', 'luca@example.com'],
  });
  const id = detail.id;
  console.log(`  Created request ${id} "${detail.title}" (${detail.status})`);
  await sleep(300);

  const anaToken = await approverTokenFor('ana@example.com', id);
  await request('POST', `/api/approvals/${id}/token/${anaToken}/otp`);
  console.log('  Issued OTP for ana@example.com (mail #1)');
  await sleep(400);
  await request('POST', `/api/approvals/${id}/token/${anaToken}/otp/regenerate`);
  console.log(
    '  Regenerated OTP for ana@example.com (mail #2) — 2 OTP mails now; the NEWEST code is valid'
  );
  await assertState(id, 'Pending demo (OTP regenerated)', 'PENDING');
  await assertRegeneratedOtps(id);
  console.log('  Fresh link + newest OTP ready — continue with the LATEST code');
}

async function seedFresh() {
  console.log('4/4 Pending demo (fresh) — drive the full happy path yourself');
  const detail = await request('POST', '/api/purchase-requests', {
    title: 'Pending demo (fresh)',
    description: 'Seeded by db:seed-scenarios — untouched; drive OTP → approve ×3 from the hub.',
    amount: 2100,
    currency: 'USD',
    requesterEmail: 'ruth@example.com',
    approverEmails: ['ana@example.com', 'sven@example.com', 'luca@example.com'],
  });
  const id = detail.id;
  console.log(`  Created request ${id} "${detail.title}" (${detail.status})`);
  console.log(
    '  Fresh approval links in mock-mail — issue the OTPs yourself through the approver console'
  );
  await assertState(id, 'Pending demo (fresh)', 'PENDING');
}

async function main() {
  console.log(`Seeding demo scenarios by driving the real API at ${API_BASE_URL}`);
  console.log(
    'Requires: backend running, table created and demo cast seeded (pnpm run demo:setup).\n'
  );

  // Resolve the demo cast ONCE — the registry is static for the run.
  const users = await request('GET', '/api/users');
  for (const email of REQUIRES) {
    if (!users.some((user) => user.email === email)) {
      throw new Error(`Demo cast missing ${email} — run \`pnpm run demo:setup\` (db:seed) first`);
    }
  }

  await seedRejected();
  console.log();
  await seedCompleted();
  console.log();
  await seedRegeneratedOtp();
  console.log();
  await seedFresh();

  console.log('\nSeed done: 4 demo scenarios created (statuses REJECTED, COMPLETED, PENDING, PENDING).');
  console.log('Note: every run creates a NEW set — no cleanup, the demo grows.');
}

main().catch((err) => {
  console.error(`\n✗ seed-scenarios failed: ${err.message}`);
  console.error(`  ${err.stack.split('\n')[1]?.trim() ?? ''}`);
  process.exitCode = 1;
});
