import { toErrorView } from './client';

describe('toErrorView', () => {
  test('maps an HTTP error body { error, message } to { status, error, message }', () => {
    const view = toErrorView({
      response: { status: 404, data: { error: 'UnknownTokenError', message: 'Token does not resolve' } },
    });
    expect(view).toEqual({
      status: 404,
      error: 'UnknownTokenError',
      message: 'Token does not resolve',
      attemptsRemaining: undefined,
    });
  });

  test('surfaces attemptsRemaining from the OTP 401 payload (endpoint #8)', () => {
    const view = toErrorView({
      response: { status: 401, data: { error: 'WrongOtpError', message: 'Incorrect code', attemptsRemaining: 2 } },
    });
    expect(view.attemptsRemaining).toBe(2);
    expect(view.status).toBe(401);
  });

  test('falls back to a synthesized message when the body has none', () => {
    const view = toErrorView({ response: { status: 500, data: {} } });
    expect(view).toEqual({
      status: 500,
      error: undefined,
      message: 'Request failed (500)',
      attemptsRemaining: undefined,
    });
  });

  test('timeout → status 0 with a retry-friendly message', () => {
    const view = toErrorView({ code: 'ECONNABORTED' });
    expect(view.status).toBe(0);
    expect(view.message).toMatch(/timed out/i);
  });

  test('network failure → status 0 with a retry-friendly message', () => {
    const view = toErrorView(new Error('Network Error'));
    expect(view.status).toBe(0);
    expect(view.message).toMatch(/network error/i);
  });
});
