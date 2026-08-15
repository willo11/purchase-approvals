import {
  ApproverRepository,
  ApproverGateState,
  AttemptIncrement,
} from '../../../src/application/ports/ApproverRepository';

/**
 * In-memory fake for the {@link ApproverRepository}.
 *
 * Seeds durable approver gate states and reproduces the atomic counter +
 * lockout and ACTIVE-reset semantics so unit tests can drive the OTP use cases
 * without AWS.
 */
export class FakeApproverRepository implements ApproverRepository {
  private approvers = new Map<string, ApproverGateState>();
  findByTokenCalls = 0;
  incrementCalls = 0;
  resetCalls = 0;
  markSignedCalls = 0;
  markRejectedCalls = 0;
  lastSignedCondition = '';
  lastRejectedCondition = '';
  lastSignature: { name: string; timestamp: string } | undefined;

  seed(requestId: string, state: ApproverGateState): this {
    this.approvers.set(`${requestId}#${state.email}`, { ...state });
    return this;
  }

  async findByToken(requestId: string, token: string): Promise<ApproverGateState | undefined> {
    this.findByTokenCalls += 1;
    for (const [key, state] of this.approvers) {
      if (key.startsWith(`${requestId}#`) && state.token === token) return { ...state };
    }
    return undefined;
  }

  async incrementAttempts(requestId: string, email: string): Promise<AttemptIncrement> {
    this.incrementCalls += 1;
    const state = this.approvers.get(`${requestId}#${email}`);
    if (!state || state.tokenStatus !== 'ACTIVE') {
      return { attempts: 3, lockedOut: true };
    }
    const next = state.attempts + 1;
    state.attempts = next;
    if (next >= 3) {
      state.tokenStatus = 'INVALIDATED_LOCKOUT';
      return { attempts: next, lockedOut: true };
    }
    return { attempts: next, lockedOut: false };
  }

  async resetAttemptsIfActive(requestId: string, email: string): Promise<boolean> {
    this.resetCalls += 1;
    const state = this.approvers.get(`${requestId}#${email}`);
    if (!state || state.tokenStatus !== 'ACTIVE') return false;
    state.attempts = 0;
    return true;
  }

  async markSigned(
    requestId: string,
    email: string,
    signature: { name: string; timestamp: string }
  ): Promise<boolean> {
    this.markSignedCalls += 1;
    this.lastSignedCondition = SIGNED_CONDITION;
    this.lastSignature = signature;
    const state = this.approvers.get(`${requestId}#${email}`);
    if (!state || state.status_signed || state.status_rejected) return false;
    state.status_signed = signature.timestamp;
    return true;
  }

  async markRejected(
    requestId: string,
    email: string,
    signature: { name: string; timestamp: string }
  ): Promise<boolean> {
    this.markRejectedCalls += 1;
    this.lastRejectedCondition = SIGNED_CONDITION;
    this.lastSignature = signature;
    const state = this.approvers.get(`${requestId}#${email}`);
    if (!state || state.status_signed || state.status_rejected) return false;
    state.status_rejected = signature.timestamp;
    return true;
  }

  gateState(requestId: string, email: string): ApproverGateState | undefined {
    const state = this.approvers.get(`${requestId}#${email}`);
    return state ? { ...state } : undefined;
  }
}

/** The exact Step A condition emitted by both approve and reject (design §3/§4). */
const SIGNED_CONDITION =
  'attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)';