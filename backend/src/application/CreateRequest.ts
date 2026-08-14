import { randomUUID } from 'node:crypto';
import { PurchaseRequest, CreateRequestInput, RequestDetail } from '../domain/PurchaseRequest';
import { UnknownUserError } from '../domain/errors';
import { RequestRepository } from './ports/RequestRepository';
import { UserRegistryPort } from './ports/UserRegistryPort';
import { TokenIssuerPort } from './ports/TokenIssuerPort';
import { MailPort } from './ports/MailPort';

/**
 * Create a purchase request use case (spec R1).
 *
 * Validates the payload (empty title/description, ≤2-decimal positive amount,
 * exactly 3 distinct approvers ≠ requester → HTTP 400), resolves every email
 * against the user registry (unknown → {@link UnknownUserError} → HTTP 404),
 * snapshots names into the item, persists the REQ item + 3 PENDING approver
 * records, and issues a per-approver approval token + simulated mail through
 * the ports (implemented in PR #3).
 *
 * Pure application logic — no framework or AWS dependencies.
 */
export class CreateRequest {
  constructor(
    private readonly repository: RequestRepository,
    private readonly registry: UserRegistryPort,
    private readonly tokenIssuer: TokenIssuerPort,
    private readonly mail: MailPort
  ) {}

  async execute(input: CreateRequestInput): Promise<RequestDetail> {
    const draft = PurchaseRequest.validateDraft(input);
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    // Resolve requester name against the registry (unknown → 404).
    const requester = await this.registry.findByEmail(
      draft.requesterEmail.toString()
    );
    if (!requester) {
      throw new UnknownUserError(
        `Requester ${draft.requesterEmail.toString()} is not registered`
      );
    }

    // Resolve approver names; each unknown email → 404.
    const approverEmails = draft.approverEmails.map((email) => email.toString());
    const resolvedApprovers: { email: string; name: string }[] = [];
    for (const email of approverEmails) {
      const user = await this.registry.findByEmail(email);
      if (!user) {
        throw new UnknownUserError(`Approver ${email} is not registered`);
      }
      resolvedApprovers.push({ email, name: user.name });
    }

    const request = PurchaseRequest.assemble({
      id,
      createdAt,
      draft,
      requesterName: requester.name,
      approverNames: resolvedApprovers.map((a) => a.name),
    });

    // Issue each approver's approval link ONCE, then reuse the SAME token for
    // both the persisted approver record and the mailed approve URL. The
    // approve flow (PR #3) resolves the URL token against the stored APPR
    // record, so the token and the mail must match.
    const links = resolvedApprovers.map((approver) =>
      this.tokenIssuer.issueApprovalLink(id, approver.email)
    );
    const approverRecords = resolvedApprovers.map((approver, index) => ({
      email: approver.email,
      name: approver.name,
      token: links[index].token,
    }));
    await this.repository.create(request, approverRecords);

    // Simulated approval-link mail per approver, reusing the same issued link.
    for (let i = 0; i < resolvedApprovers.length; i += 1) {
      const approver = resolvedApprovers[i];
      await this.mail.send({
        id: randomUUID(),
        to: approver.email,
        type: 'APPROVAL_LINK' as const,
        subject: `Approval needed: ${draft.title}`,
        body: `${approver.name}, please approve request ${id}.`,
        link: links[i].url,
        createdAt: new Date().toISOString(),
      });
    }

    return request.toDetail();
  }
}