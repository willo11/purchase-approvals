import { Route, Routes } from 'react-router-dom';
import RequestListPage from '../pages/RequestListPage';
import CreateRequestPage from '../pages/CreateRequestPage';
import RequestDetailPage from '../pages/RequestDetailPage';
import { ROUTE_PATHS } from '../routes/paths';

// CRITICAL (fresh review): the Module Federation exposed module is THIS file
// (`'./App': './src/app/App'` in webpack.config.js), so the stylesheet MUST be
// imported here to ship through the exposed module graph. When the host
// composes the remote at /requester, the remote's index.js/bootstrap never
// run — only the exposed App graph loads. Without this import the composed UI
// renders UNSTYLED. (Standalone dev on :3001 also loads it: index → bootstrap
// → App.)
import './globals.css';

/**
 * Requester remote — owns /requester* (mounted by the host under
 * /requester/*). Routes are RELATIVE to the mount point (route patterns live
 * in routes/paths.js):
 *   "/"        → list        (host: /requester)
 *   "/new"     → create form (host: /requester/new)
 *   "/:id"     → detail      (host: /requester/:id)
 */
export default function App() {
  return (
    <Routes>
      <Route path={ROUTE_PATHS.list} element={<RequestListPage />} />
      <Route path={ROUTE_PATHS.create} element={<CreateRequestPage />} />
      <Route path={ROUTE_PATHS.detail} element={<RequestDetailPage />} />
    </Routes>
  );
}
