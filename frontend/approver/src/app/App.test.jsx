import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import { apiClient } from '@/api/client';
import { resetApprovalFlowStore } from '@/store/useApprovalFlowStore';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

function renderApp(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        {/* Mirrors the host mount: the approver owns /approve* */}
        <Route path="/approve/*" element={<App />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('approver App routing — single /approve entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetApprovalFlowStore();
  });

  test('mounts the approval landing (OTP entry) at /approve with a valid link', async () => {
    apiClient.post.mockResolvedValue({ data: { expiresInSeconds: 180 } });
    renderApp('/approve?request_id=r1&approver_token=t1');
    expect(await screen.findByText('Enter your code')).toBeInTheDocument();
  });

  test('an incomplete link shows the invalid-link terminal, no API call', async () => {
    renderApp('/approve');
    expect(await screen.findByText('Invalid Link')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  test('an unknown token shows the invalid-link terminal', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 404, data: { error: 'UnknownTokenError', message: 'Token does not resolve to this approver' } },
    });
    renderApp('/approve?request_id=r1&approver_token=bad');
    expect(await screen.findByText('Invalid Link')).toBeInTheDocument();
  });
});
