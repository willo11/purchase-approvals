import { Route, Routes } from 'react-router-dom';
import RequestListScreen from './screens/RequestListScreen';
import CreateRequestScreen from './screens/CreateRequestScreen';
import RequestDetailScreen from './screens/RequestDetailScreen';

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
