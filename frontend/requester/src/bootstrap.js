import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

// Standalone mount (dev on :3001). When composed by the host, the host's
// BrowserRouter + shared react-router-dom singleton renders this component
// instead — the remote never mounts itself.
const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
