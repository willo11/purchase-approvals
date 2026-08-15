import { Route, Routes } from 'react-router-dom';
import ApprovalLandingPage from '../pages/ApprovalLandingPage';
import { ROUTE_PATHS } from '../routes/paths';

// CRITICAL (fresh review FIX 1, requester PR #6): the Module Federation
// exposed module is THIS file (`'./App': './src/app/App'` in
// webpack.config.js), so the stylesheet MUST be imported here to ship through
// the exposed module graph. When the host composes the remote at /approve,
// the remote's index.js/bootstrap never run — only the exposed App graph
// loads. Without this import the composed UI renders UNSTYLED. (Standalone
// dev on :3002 also loads it: index → bootstrap → App.)
import './globals.css';

/**
 * Approver remote — owns the single /approve entry (host: /approve/*). Two
 * route patterns resolve to the same landing page so it works in BOTH modes:
 *   "/approve" — standalone dev at http://localhost:3002/approve?...
 *   "/"        — composed by the host (the /approve/* splat strips the
 *                prefix, so the nested routes match the remainder).
 * The page reads `request_id` + `approver_token` from the URL in either mode.
 */
export default function App() {
  return (
    <Routes>
      <Route path={ROUTE_PATHS.approve} element={<ApprovalLandingPage />} />
      <Route path={ROUTE_PATHS.root} element={<ApprovalLandingPage />} />
    </Routes>
  );
}
