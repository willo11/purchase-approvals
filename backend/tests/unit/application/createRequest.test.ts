import { CreateRequest } from '../../../src/application/CreateRequest';
import { FakeUserRegistry } from '../helpers/fakeUserRegistry';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeTokenIssuer } from '../helpers/fakeTokenIssuer';
import { FakeMailPort } from '../helpers/fakeMailPort';
import {
  validCreateInput,
  registeredUsers,
} from '../helpers/purchaseRequestFixture';
import { UnknownUserError, RequesterIsApproverError } from '../../../src/domain/errors';

function buildDeps() {
  const registry = new FakeUserRegistry().seed(...registeredUsers);
  const repository = new FakeRequestRepository();
  const tokenIssuer = new FakeTokenIssuer();
  const mail = new FakeMailPort();
  const useCase = new CreateRequest(repository, registry, tokenIssuer, mail);
  return { registry, repository, tokenIssuer, mail, useCase };
}

describe('CreateRequest use case (R1)', () => {
  it('creates a PENDING request with snapshots, 3 approver records, tokens and mail', async () => {
    const { registry, repository, mail, useCase } = buildDeps();

    const detail = await useCase.execute(validCreateInput());

    expect(repository.createCalls).toBe(1);
    expect(detail.status).toBe('PENDING');
    expect(detail.createdBy).toEqual({ email: 'ana@example.com', name: 'Ana' });
    expect(detail.approvers).toHaveLength(3);
    expect(detail.approvers.map((a) => ({ email: a.email, name: a.name }))).toEqual([
      { email: 'bob@example.com', name: 'Bob' },
      { email: 'carol@example.com', name: 'Carol' },
      { email: 'dave@example.com', name: 'Dave' },
    ]);
    // 3 persisted approver records, each with a token
    expect(repository.lastApprovers).toHaveLength(3);
    expect(repository.lastApprovers.every((a) => a.token.length > 0)).toBe(true);
    // one mail per approver, all APPROVAL_LINK
    expect(mail.sendCalls).toBe(3);
    expect(mail.events.every((e) => e.type === 'APPROVAL_LINK')).toBe(true);
    expect(mail.events.map((e) => e.to).sort()).toEqual([
      'bob@example.com',
      'carol@example.com',
      'dave@example.com',
    ]);
    // registry resolved requester + 3 approvers
    expect(registry.findByEmailCalls).toBe(4);
  });

  it('issues ONE token per approver reused for BOTH the persisted record and the mailed link (R1)', async () => {
    const { repository, tokenIssuer, mail, useCase } = buildDeps();

    await useCase.execute(validCreateInput());

    // single issuance per approver (no duplicated token generation)
    expect(tokenIssuer.issueCalls).toBe(3);

    const stored = repository.lastApprovers; // 3 persisted approver records
    expect(stored).toHaveLength(3);
    for (let i = 0; i < stored.length; i += 1) {
      // the mailed link carries the SAME token as the persisted record
      const url = new URL(mail.events[i].link!);
      const mailToken = url.searchParams.get('approver_token');
      expect(mailToken).toBe(stored[i].token);
      expect(stored[i].token.length).toBeGreaterThan(0);
    }
  });

  it('raises 404 (UnknownUserError) when the requester is not registered', async () => {
    const { registry, useCase } = buildDeps();
    registry.clear();

    await expect(
      useCase.execute({ ...validCreateInput(), requesterEmail: 'ghost@example.com' })
    ).rejects.toThrow(UnknownUserError);
  });

  it('raises UnknownUserError (→404) when an approver is not registered', async () => {
    const { useCase } = buildDeps();
    const input = validCreateInput();
    (input.approverEmails as string[])[2] = 'ghost@example.com';

    await expect(useCase.execute(input)).rejects.toThrow(UnknownUserError);
  });

  it('does not persist anything when resolution fails', async () => {
    const { registry, repository, useCase } = buildDeps();
    registry.clear();

    await expect(
      useCase.execute({ ...validCreateInput(), requesterEmail: 'ghost@example.com' })
    ).rejects.toThrow(UnknownUserError);

    expect(repository.createCalls).toBe(0);
  });

  it('raises RequesterIsApproverError (→400) when requester is also an approver', async () => {
    const { useCase } = buildDeps();

    await expect(
      useCase.execute({
        ...validCreateInput(),
        requesterEmail: 'bob@example.com',
      })
    ).rejects.toThrow(RequesterIsApproverError);
    expect(useCase).toBeDefined();
  });
});