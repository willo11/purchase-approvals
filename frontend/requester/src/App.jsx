import { Route, Routes } from 'react-router-dom';
import RequestListScreen from './screens/RequestListScreen';
import CreateRequestScreen from './screens/CreateRequestScreen';
import RequestDetailScreen from './screens/RequestDetailScreen';

// CRITICAL (fresh review): the Module Federation exposed module is THIS file
// (`'./App': './src/App'` in webpack.config.js), so the stylesheet MUST be
// imported here to ship through the exposed module graph. When the host
// composes the remote at /requester, the remote's index.js/bootstrap never
// run — only the exposed App graph loads. Without this import the composed UI
// renders UNSTYLED. (Standalone dev on :3001 also loads it: index → bootstrap
// → App.)
import './globals.css';

/**
 * Requester remote — owns /requester* (mounted by the host under
 * /requester/*). Routes are RELATIVE to the mount point:
 *   "/"        → list        (host: /requester)
 *   "/new"     → create form (host: /requester/new)
 *   "/:id"     → detail      (host: /requester/:id)
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RequestListScreen />} />
      <Route path="/new" element={<CreateRequestScreen />} />
      <Route path="/:id" element={<RequestDetailScreen />} />
    </Routes>
  );
}
