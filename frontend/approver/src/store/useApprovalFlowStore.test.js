import {
  FLOW_PHASES,
  TERMINAL_VARIANTS,
  resetApprovalFlowStore,
  useApprovalFlowStore,
} from './useApprovalFlowStore';

describe('approval flow store (state machine, task 7.5)', () => {
  beforeEach(() => {
    resetApprovalFlowStore();
  });

  test('startFlow begins at the gate phase with the link params', () => {
    useApprovalFlowStore.getState().startFlow({ requestId: 'r1', approverToken: 't1' });
    const state = useApprovalFlowStore.getState();
    expect(state.requestId).toBe('r1');
    expect(state.approverToken).toBe('t1');
    expect(state.phase).toBe(FLOW_PHASES.GATE);
    expect(state.terminalVariant).toBeNull();
  });

  test('enterOtpEntry moves to OTP entry and clears attempts (R1)', () => {
    const store = useApprovalFlowStore.getState();
    store.startFlow({ requestId: 'r1', approverToken: 't1' });
    store.setAttemptsRemaining(2);
    store.enterOtpEntry({ expiresInSeconds: 180 });
    const state = useApprovalFlowStore.getState();
    expect(state.phase).toBe(FLOW_PHASES.OTP);
    expect(state.expiresInSeconds).toBe(180);
    expect(state.attemptsRemaining).toBeNull();
  });

  test('enterDecision moves to the request detail step (R3)', () => {
    useApprovalFlowStore.getState().enterDecision();
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.DECISION);
  });

  test('enterTerminal records the variant and blocks further steps (R1/R4)', () => {
    useApprovalFlowStore.getState().enterTerminal(TERMINAL_VARIANTS.COMPLETED);
    const state = useApprovalFlowStore.getState();
    expect(state.phase).toBe(FLOW_PHASES.TERMINAL);
    expect(state.terminalVariant).toBe(TERMINAL_VARIANTS.COMPLETED);
  });

  test('setAttemptsRemaining records the R2 countdown', () => {
    useApprovalFlowStore.getState().setAttemptsRemaining(2);
    expect(useApprovalFlowStore.getState().attemptsRemaining).toBe(2);
  });

  test('setExpiresInSeconds refreshes the OTP window after regeneration (R2)', () => {
    useApprovalFlowStore.getState().enterOtpEntry({ expiresInSeconds: 180 });
    expect(useApprovalFlowStore.getState().expiresInSeconds).toBe(180);
    useApprovalFlowStore.getState().setExpiresInSeconds(300);
    expect(useApprovalFlowStore.getState().expiresInSeconds).toBe(300);
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.OTP);
  });
});
