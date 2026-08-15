import { Amount } from './values/Amount';
import { Email } from './values/Email';
import { GlobalStatus } from './enums/GlobalStatus';
import { Approver, ApproverView } from './Approver';
import {
  EmptyTitleError,
  EmptyDescriptionError,
  InvalidApproverCountError,
  DuplicateApproverError,
  RequesterIsApproverError,
} from './errors';

/**
 * Raw payload for `POST /api/purchase-requests` (design R1). Field types are
 * `unknown` so the domain validates everything itself.
 */
export interface CreateRequestInput {
  title: unknown;
  description: unknown;
  amount: unknown;
  requesterEmail: unknown;
  approverEmails: unknown;
}

/**
 * A validated, normalized draft awaiting name snapshot resolution. Request and
 * approver emails are validated here; their registry names are resolved later
 * by the use case (which raises 404 for unknowns).
 */
export interface PurchaseRequestDraft {
  title: string;
  description: string;
  amount: Amount;
  requesterEmail: Email;
  approverEmails: Email[];
}

/** Inputs the use case has after registry resolution. */
export interface AssembleRequestInput {
  id: string;
  createdAt: string;
  draft: PurchaseRequestDraft;
  requesterName: string;
  approverNames: string[];
}

/** Summary shape for the list endpoint (design-api `RequestSummary`). */
export interface RequestSummary {
  id: string;
  title: string;
  amount: number;
  currency: string;
  status: GlobalStatus;
  createdAt: string;
}

/** Detail shape for create + detail endpoints (design-api `RequestDetail`). */
export interface RequestDetail {
  id: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
  status: GlobalStatus;
  createdBy: { email: string; name: string };
  approvers: ApproverView[];
  createdAt: string;
  /**
   * Deterministic S3 evidence key (`reqs/<id>/evidence.pdf`), present ONLY
   * after a successful generation (spec R2, design-concurrency §5). Absent
   * while PENDING/REJECTED and after a failed generation (R4) — the download
   * endpoint 404s until it exists.
   */
  evidenceKey?: string;
}

const REQUIRED_APPROVERS = 3;

/**
 * Purchase request aggregate (PR #2 concept: "the aggregate").
 *
 * Owns creation invariants (R1): non-empty title/description, positive amount
 * with ≤2 decimals, exactly 3 approver emails, distinct from one another and
 * from the requester. Snapshots of `createdBy`/`approvers` names are embedded
 * at creation (design Decision 3). Zero framework dependencies.
 */
export class PurchaseRequest {
  private constructor(
    private readonly id: string,
    private readonly title: string,
    private readonly description: string,
    private readonly amount: Amount,
    private readonly requester: { email: Email; name: string },
    private readonly approvers: Approver[],
    private readonly status: GlobalStatus,
    private readonly createdAt: string
  ) {}

  /**
   * Validates a raw create payload and returns a normalized draft. Empties,
   * bad amounts, wrong approver count, duplicates and requester-overlap all
   * raise domain errors (→ HTTP 400). Registry existence is checked later.
   */
  static validateDraft(input: CreateRequestInput): PurchaseRequestDraft {
    const title = PurchaseRequest.validateTitle(input.title);
    const description = PurchaseRequest.validateDescription(input.description);
    const amount = Amount.create(input.amount);
    const requesterEmail = Email.create(input.requesterEmail);

    const approverEmails = PurchaseRequest.validateApprovers(input.approverEmails);
    PurchaseRequest.assertDistinctFromRequester(requesterEmail, approverEmails);

    return { title, description, amount, requesterEmail, approverEmails };
  }

  /**
   * Assembles a `PENDING` request from a resolved draft, embedding name
   * snapshots. `approverNames` MUST be aligned in order with
   * `draft.approverEmails`.
   */
  static assemble(input: AssembleRequestInput): PurchaseRequest {
    if (input.approverNames.length !== input.draft.approverEmails.length) {
      throw new InvalidApproverCountError(
        'Approver names must align with approver emails'
      );
    }
    const approvers = input.draft.approverEmails.map((email, index) =>
      Approver.at(email, input.approverNames[index])
    );
    return new PurchaseRequest(
      input.id,
      input.draft.title,
      input.draft.description,
      input.draft.amount,
      { email: input.draft.requesterEmail, name: input.requesterName },
      approvers,
      GlobalStatus.PENDING,
      input.createdAt
    );
  }

  getId(): string {
    return this.id;
  }

  getStatus(): GlobalStatus {
    return this.status;
  }

  getRequesterEmail(): Email {
    return this.requester.email;
  }

  getApprovers(): Approver[] {
    return this.approvers;
  }

  toSummary(): RequestSummary {
    return {
      id: this.id,
      title: this.title,
      amount: this.amount.getValue(),
      currency: this.amount.getCurrency(),
      status: this.status,
      createdAt: this.createdAt,
    };
  }

  toDetail(): RequestDetail {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      amount: this.amount.getValue(),
      currency: this.amount.getCurrency(),
      status: this.status,
      createdBy: {
        email: this.requester.email.toString(),
        name: this.requester.name,
      },
      approvers: this.approvers.map((approver) => approver.toView()),
      createdAt: this.createdAt,
    };
  }

  private static validateTitle(raw: unknown): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new EmptyTitleError('Title must be a non-empty string');
    }
    return raw.trim();
  }

  private static validateDescription(raw: unknown): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new EmptyDescriptionError('Description must be a non-empty string');
    }
    return raw.trim();
  }

  private static validateApprovers(raw: unknown): Email[] {
    if (!Array.isArray(raw) || raw.length !== REQUIRED_APPROVERS) {
      throw new InvalidApproverCountError(
        `Approvers must be exactly ${REQUIRED_APPROVERS} emails`
      );
    }
    const emails = raw.map((email) => Email.create(email));
    const unique = new Set(emails.map((email) => email.toString()));
    if (unique.size !== REQUIRED_APPROVERS) {
      throw new DuplicateApproverError(
        'Approver emails must be distinct from one another'
      );
    }
    return emails;
  }

  private static assertDistinctFromRequester(
    requester: Email,
    approvers: Email[]
  ): void {
    const requesterEmail = requester.toString();
    if (approvers.some((email) => email.toString() === requesterEmail)) {
      throw new RequesterIsApproverError(
        'The requester cannot also be an approver'
      );
    }
  }
}