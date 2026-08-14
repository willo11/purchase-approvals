/**
 * OTP policy constants shared across the OTP flow (spec R3/R5/R6).
 */
export const OTP_TTL_SECONDS = 180; // 3 minutes (spec R3)
export const OTP_LOCKOUT_LIMIT = 3; // 3 consecutive failures → invalidate (spec R5)
export const OTP_TTL_MS = OTP_TTL_SECONDS * 1000;