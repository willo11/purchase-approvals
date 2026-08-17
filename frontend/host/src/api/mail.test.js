import { apiClient } from './client';
import { findApprovalLinkFor, isSameOrigin, listMail } from './mail';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

describe('listMail (mock-mail inbox)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GETs /mock-mail with the ?to parameter', async () => {
    apiClient.get.mockResolvedValue({ data: [{ id: 'm1' }] });
    const result = await listMail('ana@example.com');
    expect(apiClient.get).toHaveBeenCalledWith('/mock-mail', {
      params: { to: 'ana@example.com' },
    });
    expect(result).toEqual([{ id: 'm1' }]);
  });

  test('GETs /mock-mail without params when no recipient given', async () => {
    apiClient.get.mockResolvedValue({ data: [] });
    await listMail();
    expect(apiClient.get).toHaveBeenCalledWith('/mock-mail', { params: undefined });
  });
});

describe('findApprovalLinkFor', () => {
  const mails = [
    {
      id: 'm1',
      to: 'ana@example.com',
      type: 'OTP',
      link: undefined,
      otpPlain: '123456',
    },
    {
      id: 'm2',
      to: 'ana@example.com',
      type: 'APPROVAL_LINK',
      link: 'http://localhost:3000/approve?request_id=req-1&approver_token=aaa',
    },
    {
      id: 'm3',
      to: 'sven@example.com',
      type: 'APPROVAL_LINK',
      link: 'https://deployed.example.com/approve?request_id=req-2&approver_token=bbb',
    },
    { id: 'm4', to: 'ana@example.com', type: 'APPROVAL_LINK', link: 'not a url' },
  ];

  test('returns the link whose request_id matches, regardless of origin', () => {
    expect(findApprovalLinkFor(mails, 'req-1')).toBe(
      'http://localhost:3000/approve?request_id=req-1&approver_token=aaa'
    );
    expect(findApprovalLinkFor(mails, 'req-2')).toBe(
      'https://deployed.example.com/approve?request_id=req-2&approver_token=bbb'
    );
  });

  test('returns null when no mail carries a link with that request_id', () => {
    expect(findApprovalLinkFor(mails, 'req-999')).toBeNull();
  });

  test('skips mails without a link (OTP mails) and malformed URLs', () => {
    expect(findApprovalLinkFor(mails, 'req-1')).not.toBeNull();
  });

  test('tolerates an empty or null mail list', () => {
    expect(findApprovalLinkFor([], 'req-1')).toBeNull();
    expect(findApprovalLinkFor(null, 'req-1')).toBeNull();
  });
});

describe('isSameOrigin (console navigation guard)', () => {
  test('true when the mailed link shares the console origin', () => {
    expect(
      isSameOrigin(
        'http://localhost:3000/approve?request_id=req-1&approver_token=aaa',
        'http://localhost:3000'
      )
    ).toBe(true);
  });

  test('false when the link points at the raw backend (APPROVER_BASE_URL unset)', () => {
    expect(
      isSameOrigin(
        'http://localhost:4000/approve?request_id=req-1&approver_token=aaa',
        'http://localhost:3000'
      )
    ).toBe(false);
  });

  test('false for a different host or malformed URL', () => {
    expect(
      isSameOrigin('https://other.example.com/approve?request_id=req-1', 'http://localhost:3000')
    ).toBe(false);
    expect(isSameOrigin('not a url', 'http://localhost:3000')).toBe(false);
  });
});