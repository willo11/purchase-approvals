import { ROUTE_PATHS, buildApprovalLink } from './paths';

describe('approver route paths + link builder', () => {
  test('the single /approve entry is declared for both mount modes', () => {
    expect(ROUTE_PATHS.approve).toBe('/approve');
    expect(ROUTE_PATHS.root).toBe('/');
  });

  test('buildApprovalLink produces the mailed link form', () => {
    const link = buildApprovalLink('req-1', 'tok-abc', 'https://example.com');
    expect(link).toBe(
      'https://example.com/approve?request_id=req-1&approver_token=tok-abc'
    );
  });

  test('buildApprovalLink URL-encodes special characters in ids/tokens', () => {
    const link = buildApprovalLink('a b', 'x&y');
    expect(link).toBe('/approve?request_id=a+b&approver_token=x%26y');
    expect(link).not.toContain('x&y=');
  });
});
