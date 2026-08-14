import { createRoot } from 'react-dom/client';
import App from './App';

// Standalone mount (dev on :3001). When composed by the host, the host's React
// instance renders this component instead — the remote never mounts itself.
const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
