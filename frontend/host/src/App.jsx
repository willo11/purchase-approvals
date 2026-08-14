import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Landing from './Landing';

const SolicitanteApp = lazy(() => import('solicitante/App'));
const AprobadorApp = lazy(() => import('aprobador/App'));

/**
 * Shell routes. Each remote owns its routes: the solicitante remote owns
 * /solicitante* (PR #6), the aprobador remote owns /approve* (PR #7). The host
 * only composes them lazily — remotes never need to know about navigation.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/solicitante/*"
        element={
          <Suspense fallback={<div>Loading solicitante module...</div>}>
            <SolicitanteApp />
          </Suspense>
        }
      />
      <Route
        path="/approve/*"
        element={
          <Suspense fallback={<div>Loading approver module...</div>}>
            <AprobadorApp />
          </Suspense>
        }
      />
    </Routes>
  );
}
