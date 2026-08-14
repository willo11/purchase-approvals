import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Landing from './Landing';

const RequesterApp = lazy(() => import('requester/App'));
const ApproverApp = lazy(() => import('approver/App'));

/**
 * Shell routes. Each remote owns its routes: the requester remote owns
 * /requester* (PR #6), the approver remote owns /approve* (PR #7). The host
 * only composes them lazily — remotes never need to know about navigation.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/requester/*"
        element={
          <Suspense fallback={<div>Loading requester module...</div>}>
            <RequesterApp />
          </Suspense>
        }
      />
      <Route
        path="/approve/*"
        element={
          <Suspense fallback={<div>Loading approver module...</div>}>
            <ApproverApp />
          </Suspense>
        }
      />
    </Routes>
  );
}
