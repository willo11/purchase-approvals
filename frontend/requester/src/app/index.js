// Dynamic import creates the async boundary required by Module Federation.
import('./bootstrap');

// NOTE: the global stylesheet is imported from app/App.jsx (the MF EXPOSED
// module) so it ships through the composed module graph. Standalone dev also
// reaches it via index → bootstrap → App.
