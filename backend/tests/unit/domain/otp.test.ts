import { Otp } from '../../../src/domain/values/Otp';
import { Token } from '../../../src/domain/values/Token';
import { OtpService } from '../../../src/domain/services/OtpService';
import {
  OTP_TTL_SECONDS,
  OTP_LOCKOUT_LIMIT,
} from '../../../src/domain/services/otpConstants';
import { InvalidOtpCodeError } from '../../../src/domain/errors';

describe('Otp value object (spec R3)', () => {
  it('generates a 6-digit numeric code', () => {
    for (let i = 0; i < 50; i += 1) {
      const otp = Otp.generate();
      expect(otp.toString()).toMatch(/^\d{6}$/);
    }
  });

  it('accepts a valid 6-digit code and rejects malformed ones', () => {
    expect(Otp.create('123456').toString()).toBe('123456');
    expect(() => Otp.create('abc')).toThrow(InvalidOtpCodeError);
    expect(() => Otp.create('12345')).toThrow(InvalidOtpCodeError);
    expect(() => Otp.create('1234567')).toThrow(InvalidOtpCodeError);
    expect(() => Otp.create(123456)).toThrow(InvalidOtpCodeError);
  });

  it('compares by value', () => {
    expect(Otp.create('000000').equals(Otp.create('000000'))).toBe(true);
    expect(Otp.create('000000').equals(Otp.create('000001'))).toBe(false);
  });
});

describe('Token value object (spec R1)', () => {
  it('produces unique URL-safe uuids', () => {
    const a = Token.urlSafe();
    const b = Token.urlSafe();
    expect(a.toString()).not.toBe(b.toString());
    expect(a.toString()).toMatch(/^[0-9a-f-]{36}$/);
    // URL-safe: no reserved characters that need escaping in a query
    expect(a.toString()).not.toMatch(/[%&=+]/);
  });

  it('round-trips via fromString and equals', () => {
    const a = Token.fromString('some-token');
    expect(a.equals(Token.fromString('some-token'))).toBe(true);
    expect(a.equals(Token.fromString('other'))).toBe(false);
  });
});

describe('OtpService (spec R3/R4)', () => {
  it('hashes deterministically and never embeds the plain code in the digest', () => {
    const service = new OtpService();
    const otp = Otp.create('123456');

    const h1 = service.hash(otp, 'req-1#bob@example.com');
    const h2 = service.hash(otp, 'req-1#bob@example.com');

    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toContain('123456');
    // context matters: same code in a different approver yields a different hash
    expect(service.hash(otp, 'req-1#carol@example.com')).not.toBe(h1);
  });

  it('exposes the shared OTP policy constants', () => {
    expect(OTP_TTL_SECONDS).toBe(180);
    expect(OTP_LOCKOUT_LIMIT).toBe(3);
  });
});