// Dynamic import creates the async boundary required by Module Federation:
// shared chunks load before the shell initializes.
import('./bootstrap');

// Tailwind + design tokens for the host shell (kept minimal: nav + layout).
import './globals.css';
