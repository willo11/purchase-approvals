import { useRequestStore } from './useRequestStore';

describe('useRequestStore (scoped local UI state)', () => {
  beforeEach(() => {
    // Reset to initial state between tests.
    useRequestStore.setState({ listRefreshSignal: 0 });
  });

  test('starts with refresh signal 0', () => {
    expect(useRequestStore.getState().listRefreshSignal).toBe(0);
  });

  test('bumpListRefresh increments the signal', () => {
    useRequestStore.getState().bumpListRefresh();
    useRequestStore.getState().bumpListRefresh();
    expect(useRequestStore.getState().listRefreshSignal).toBe(2);
  });
});
