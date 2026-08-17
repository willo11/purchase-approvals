import { toErrorView } from './client';

describe('toErrorView (host: surface errors without crashing)', () => {
  test('maps an HTTP error body {error, message}', () => {
    const view = toErrorView({
      response: { status: 400, data: { error: 'Validation', message: 'Bad amount' } },
    });
    expect(view).toEqual({ status: 400, message: 'Bad amount' });
  });

  test('falls back to a status message when no body message', () => {
    const view = toErrorView({ response: { status: 404, data: {} } });
    expect(view.status).toBe(404);
    expect(view.message).toContain('404');
  });

  test('maps timeouts', () => {
    const view = toErrorView({ code: 'ECONNABORTED' });
    expect(view.status).toBe(0);
    expect(view.message).toContain('timed out');
  });

  test('maps network failures', () => {
    const view = toErrorView(new Error('Network Error'));
    expect(view.status).toBe(0);
    expect(view.message).toContain('Network error');
  });
});