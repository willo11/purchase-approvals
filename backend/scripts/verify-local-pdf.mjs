#!/usr/bin/env node
// End-to-end proof that the LOCAL in-memory evidence store serves the evidence
// PDF when handlers run under `serverless offline --useInProcess`.
//
// WHY THIS EXISTS (see commit "fix(backend): share the in-memory evidence
// store across offline handlers"): serverless-offline's DEFAULT runner gives
// each Lambda function its own isolated worker-thread module scope, so the
// approval handler put the PDF into one in-memory map and the download handler
// read an empty one — every download 404'd even though generation succeeded.
// With `--useInProcess` all handlers share the process-wide singleton store.
// A unit test that `makeEvidenceStore() === makeEvidenceStore()` cannot prove
// this (it is true by construction); only a REAL HTTP round-trip through a
// running offline server can.
//
// This script boots its own `serverless offline --useInProcess`, drives the
// full happy path through the API (create -> issue OTP -> read code from
// mock-mail -> validate -> approve x3 -> COMPLETED), downloads the evidence
// PDF and asserts 200 + application/pdf + non-empty %PDF bytes, prints
// PASS/FAIL, then kills the server.
//
// Requirements: Node 20+, dynamodb-local up (pnpm -C backend run db:up) and
// the table created (pnpm -C backend run db:create-table). Needs :4000 free.
//
// Usage:
//   pnpm -C backend run test:offline-pdf
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.API_BASE_URL ?? 'http://localhost:4000/dev';

// Same demo cast as seed-demo.mjs (requester + 3 approvers). The script
// registers any that are missing via the API, so it only needs dynamodb + the
// table — it is self-contained against a clean state.
const CAST = [
  { name: 'Ruth', email: 'ruth@example.com', position: 'Manager' },
  { name: 'Ana', email: 'ana@example.com', position: 'Analyst' },
  { name: 'Sven', email: 'sven@example.com', position: 'Director' },
  { name: 'Luca', email: 'luca@example.com', position: 'Compliance' },
];
const APPROVERS = ['ana@example.com', 'sven@example.com', 'luca@example.com'];

const sleep = (ms) => new Promise((resolve_) => setTimeout(resolve_, ms));

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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

async function waitForHealth(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(400);
  }
  throw new Error(`Timeout: offline server at ${BASE}/health did not become healthy`);
}

function parseLink(link) {
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

async function approvalTokenFor(email, requestId) {
  const mails = await request('GET', `/mock-mail?to=${encodeURIComponent(email)}`);
  const linkMail = mails.find(
    (mail) => mail.type === 'APPROVAL_LINK' && parseLink(mail.link).requestId === requestId
  );
  if (!linkMail) throw new Error(`No approval link found for ${email} on ${requestId}`);
  const token = parseLink(linkMail.link).token;
  if (!token) throw new Error(`Approval link for ${email} on ${requestId} lacks approver_token`);
  return token;
}

async function latestOtp(email, requestId) {
  const mails = await request('GET', `/mock-mail?to=${encodeURIComponent(email)}`);
  const otpMails = mails.filter((m) => m.type === 'OTP' && m.subject?.includes(requestId));
  if (otpMails.length === 0) throw new Error(`No OTP mail for ${email} on ${requestId}`);
  return otpMails[0].otpPlain; // newest first
}

async function driveCompletedFlow() {
  // Ensure the demo cast exists (self-contained on a clean table).
  const users = await request('GET', '/api/users');
  for (const user of CAST) {
    if (users.some((u) => u.email === user.email)) continue;
    await request('POST', '/api/users', user);
  }

  const detail = await request('POST', '/api/purchase-requests', {
    title: 'Local PDF round-trip',
    description: 'Driven by verify-local-pdf.mjs through the real API.',
    amount: 1234,
    currency: 'USD',
    requesterEmail: 'ruth@example.com',
    approverEmails: APPROVERS,
  });
  const id = detail.id;
  console.log(`  Created request ${id} (PENDING)`);
  await sleep(300); // approval-link mails land before we read them

  for (const email of APPROVERS) {
    const token = await approvalTokenFor(email, id);
    await request('POST', `/api/approvals/${id}/token/${token}/otp`); // issue
    await sleep(400); // newest-mail ordering under GSI eventual consistency
    const code = await latestOtp(email, id);
    await request('POST', `/api/approvals/${id}/token/${token}/otp/validate`, { code });
    await request('POST', `/api/approvals/${id}/token/${token}/approve`);
    console.log(`  OTP + approved ${email}`);
  }

  const final = await request('GET', `/api/purchase-requests/${id}`);
  if (final.status !== 'COMPLETED') {
    throw new Error(`Request ${id} expected COMPLETED, got ${final.status}`);
  }
  console.log(`  Request ${id} COMPLETED ✓`);

  // Download the evidence PDF and assert 200 + application/pdf + non-empty %PDF.
  const res = await fetch(`${BASE}/api/purchase-requests/${id}/evidence.pdf`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  const head = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  if (res.status !== 200) {
    throw new Error(`Evidence download expected HTTP 200, got ${res.status}`);
  }
  if (!type.toLowerCase().includes('application/pdf')) {
    throw new Error(`Evidence expected application/pdf, got "${type}"`);
  }
  if (bytes.length === 0) {
    throw new Error('Evidence PDF is empty');
  }
  if (head !== '%PDF') {
    throw new Error(`Evidence bytes do not start with %PDF (got "${head}")`);
  }
  console.log(`  Evidence download HTTP ${res.status}, ${type}, ${bytes.length} bytes, %PDF header ✓`);
}

function kill(proc) {
  return new Promise((resolveKill) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolveKill();
    proc.on('exit', () => resolveKill());
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill('SIGKILL');
      }
    }, 3000);
    setTimeout(() => resolveKill(), 5000);
  });
}

async function main() {
  console.log(`verify-local-pdf: booting serverless offline --useInProcess (base ${BASE})`);

  const server = spawn('pnpm', ['exec', 'serverless', 'offline', '--useInProcess'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DYNAMODB_LOCAL: process.env.DYNAMODB_LOCAL ?? 'http://localhost:8000',
      TABLE_NAME: process.env.TABLE_NAME ?? 'purchase-approvals-dev',
      EVIDENCE_STORE: 'memory',
      APPROVER_BASE_URL: process.env.APPROVER_BASE_URL ?? 'http://localhost:3000',
      SERVERLESS_PORT: '4000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  server.stdout.on('data', (d) => (out += d));
  server.stderr.on('data', (d) => (out += d));

  try {
    await waitForHealth();
    await driveCompletedFlow();
    console.log('\nPASS ✓ end-to-end local PDF round-trip (200, application/pdf, non-empty %PDF bytes).');
    process.exitCode = 0;
  } catch (err) {
    console.error(`\nFAIL ✗ ${err.message}`);
    console.error(out);
    process.exitCode = 1;
  } finally {
    await kill(server);
  }
}

main();
