// Dynamic import creates the async boundary required by Module Federation:
// shared chunks load before the shell initializes.
import('./bootstrap');
