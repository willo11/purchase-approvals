import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
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
    <div className="min-h-screen">
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <Link to="/" className="font-semibold">
            Purchase Approvals
          </Link>
          <div className="flex gap-4 text-sm">
            <Link to="/requester" className="hover:underline">
              Requester
            </Link>
            <Link to="/approve" className="hover:underline">
              Approver
            </Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
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
      </main>
    </div>
  );
}
