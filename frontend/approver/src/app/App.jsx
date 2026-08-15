// CRITICAL (fresh review FIX 1, requester PR #6): the Module Federation
// exposed module is THIS file (`'./App': './src/app/App'` in
// webpack.config.js), so the stylesheet MUST be imported here to ship through
// the exposed module graph. When the host composes the remote at /approve,
// the remote's index.js/bootstrap never run — only the exposed App graph
// loads. Without this import the composed UI renders UNSTYLED. (Standalone
// dev on :3002 also loads it: index → bootstrap → App.)
import './globals.css';

// Placeholder wiring — replaced by the /approve entry (ApprovalLandingPage)
// in task 7.1; the API/store/hooks foundation lands first so every commit
// builds and tests green.
export default function App() {
  return (
    <main>
      <h1>Approver module</h1>
      <p>Placeholder — OTP gate and decision views live here (PR #7).</p>
    </main>
  );
}
