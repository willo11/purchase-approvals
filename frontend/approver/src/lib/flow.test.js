import { TERMINAL_VARIANTS, terminalVariantFromError } from './flow';

describe('terminalVariantFromError (state machine, task 7.5)', () => {
  test('403 → locked-out (token invalidated after 3 wrong codes)', () => {
    expect(
      terminalVariantFromError({ status: 403, message: 'Approver token is invalidated (lockout)' })
    ).toBe(TERMINAL_VARIANTS.LOCKED_OUT);
  });

  test('404 → invalid link (unknown request or token)', () => {
    expect(
      terminalVariantFromError({ status: 404, message: 'Request r1 not found' })
    ).toBe(TERMINAL_VARIANTS.INVALID_LINK);
    expect(
      terminalVariantFromError({ status: 404, message: 'Token does not resolve to this approver' })
    ).toBe(TERMINAL_VARIANTS.INVALID_LINK);
  });

  test('409 with signed message → already signed (R1)', () => {
    expect(
      terminalVariantFromError({ status: 409, message: 'This approver already signed the request' })
    ).toBe(TERMINAL_VARIANTS.ALREADY_SIGNED);
  });

  test('409 with rejected message → already rejected (R1/R4)', () => {
    expect(
      terminalVariantFromError({ status: 409, message: 'This approver already rejected the request' })
    ).toBe(TERMINAL_VARIANTS.ALREADY_REJECTED);
  });

  test('410 with COMPLETED message → completed terminal (R1)', () => {
    expect(
      terminalVariantFromError({ status: 410, message: 'Request r1 is already COMPLETED; no OTP flow is offered' })
    ).toBe(TERMINAL_VARIANTS.COMPLETED);
  });

  test('410 with REJECTED message → already rejected terminal (R1)', () => {
    expect(
      terminalVariantFromError({ status: 410, message: 'Request r1 is already REJECTED; no OTP flow is offered' })
    ).toBe(TERMINAL_VARIANTS.ALREADY_REJECTED);
  });

  test('410 ExpiredOtpError is NOT terminal — the OTP screen offers regeneration (R2)', () => {
    expect(
      terminalVariantFromError({ status: 410, error: 'ExpiredOtpError', message: 'The OTP is missing or expired' })
    ).toBeNull();
  });

  test('non-terminal errors (401 wrong OTP, network) return null', () => {
    expect(
      terminalVariantFromError({ status: 401, message: 'Incorrect code' })
    ).toBeNull();
    expect(
      terminalVariantFromError({ status: 0, message: 'Network error' })
    ).toBeNull();
    expect(terminalVariantFromError({})).toBeNull();
    expect(terminalVariantFromError(undefined)).toBeNull();
  });
});
