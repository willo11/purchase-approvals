import { render, screen } from '@testing-library/react';
import TerminalPage, { TERMINAL_COPY } from './TerminalPage';
import { TERMINAL_VARIANTS, resetApprovalFlowStore, useApprovalFlowStore } from '@/store/useApprovalFlowStore';

function renderVariant(variant) {
  useApprovalFlowStore.getState().enterTerminal(variant);
  return render(<TerminalPage />);
}

describe('TerminalPage — R4/R1 informational screens, no actions', () => {
  beforeEach(() => {
    resetApprovalFlowStore();
  });

  const cases = [
    [TERMINAL_VARIANTS.COMPLETED, 'Request Completed'],
    [TERMINAL_VARIANTS.ALREADY_SIGNED, 'Already Signed'],
    [TERMINAL_VARIANTS.ALREADY_REJECTED, 'Request Rejected'],
    [TERMINAL_VARIANTS.INVALID_LINK, 'Invalid Link'],
    [TERMINAL_VARIANTS.APPROVED, 'Request Approved'],
    [TERMINAL_VARIANTS.REJECTED, 'Request Rejected'],
  ];

  test.each(cases)('%s renders its informational copy and no buttons', (variant, title) => {
    renderVariant(variant);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(TERMINAL_COPY[variant].message)).toBeInTheDocument();
    // No actions — no buttons anywhere on a terminal screen (R4).
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('unknown variant falls back to a neutral message, still no actions', () => {
    renderVariant('mystery');
    expect(screen.getByText('Approval Flow')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
