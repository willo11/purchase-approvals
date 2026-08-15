import { create } from 'zustand';

/**
 * Scoped LOCAL UI state only — the backend is the source of truth for all
 * business data (see frontend/DECISIONS.md, zustand entry).
 *
 * Holds exactly ONE signal: a monotonically increasing list-refresh counter.
 * The create screen bumps it after a successful POST so the list screen
 * refetches even if it stayed mounted (e.g. browser back). No request data,
 * no users, no duplicated API state lives here.
 */
export const useRequestStore = create((set) => ({
  listRefreshSignal: 0,
  bumpListRefresh: () =>
    set((state) => ({ listRefreshSignal: state.listRefreshSignal + 1 })),
}));
