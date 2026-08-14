import { Email } from './values/Email';
import { ApproverStatus } from './enums/ApproverStatus';

/**
 * Plain view of one approver record, as exposed by the detail endpoint
 * (design-api `ApproverView`).
 */
export interface ApproverView {
  email: string;
  name: string;
  status: ApproverStatus;
  signedAt?: string;
  rejectedAt?: string;
}

/**
 * Raw shape of an approver row as persisted by the repository (design R1/R4).
 * The signature capability (PR #4) writes `status_signed`/`status_rejected`;
 * before that, neither field is present and the approver is `PENDING`.
 */
export interface ApproverSnapshot {
  email: string;
  name: string;
  status_signed?: string;
  status_rejected?: string;
}

/**
 * Approver record of a purchase request (design R1).
 *
 * Holds the registered-name snapshot plus the per-approver status. Status is
 * derived from the persisted signature timestamps. Zero framework
 * dependencies.
 */
export class Approver {
  private constructor(
    private readonly email: Email,
    private readonly name: string,
    private readonly status: ApproverStatus,
    private readonly signedAt?: string,
    private readonly rejectedAt?: string
  ) {}

  /** Builds a NEW approver record around a validated email, always `PENDING`. */
  static at(email: Email, name: string): Approver {
    return new Approver(email, name, ApproverStatus.PENDING);
  }

  /** Rehydrates an approver from a persisted row, deriving its status. */
  static fromSnapshot(snapshot: ApproverSnapshot): Approver {
    if (snapshot.status_signed) {
      return new Approver(
        Email.create(snapshot.email),
        snapshot.name,
        ApproverStatus.SIGNED,
        snapshot.status_signed,
        undefined
      );
    }
    if (snapshot.status_rejected) {
      return new Approver(
        Email.create(snapshot.email),
        snapshot.name,
        ApproverStatus.REJECTED,
        undefined,
        snapshot.status_rejected
      );
    }
    return new Approver(
      Email.create(snapshot.email),
      snapshot.name,
      ApproverStatus.PENDING
    );
  }

  getEmail(): Email {
    return this.email;
  }

  getName(): string {
    return this.name;
  }

  getStatus(): ApproverStatus {
    return this.status;
  }

  /** Shape returned by the detail endpoint (design-api `ApproverView`). */
  toView(): ApproverView {
    const view: ApproverView = {
      email: this.email.toString(),
      name: this.name,
      status: this.status,
    };
    if (this.signedAt) view.signedAt = this.signedAt;
    if (this.rejectedAt) view.rejectedAt = this.rejectedAt;
    return view;
  }
}