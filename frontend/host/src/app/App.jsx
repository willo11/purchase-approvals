import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import Landing from '../pages/LandingPage';
import DemoPage from '../pages/DemoPage';

const RequesterApp = lazy(() => import('requester/App'));
const ApproverApp = lazy(() => import('approver/App'));

/**
 * Shell routes. The host owns the demo hub (/), the approver console (/demo)
 * and the app-shell routes; each remote owns its own: the requester remote
 * owns /requester* (PR #6), the approver remote owns /approve* (PR #7). The
 * host composes the remotes lazily — remotes never need to know about
 * navigation.
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
            <Link to="/demo" className="hover:underline">
              Approver console
            </Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/demo" element={<DemoPage />} />
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
