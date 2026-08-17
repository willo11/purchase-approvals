// Regression guard (refresh-crash fix): the host's injected <script src> MUST
// be ABSOLUTE (`/main.[hash].js`). With a RELATIVE src, a deep URL like
// /requester/<id> resolves it to .../requester/main.[hash].js, the dev server
// returns index.html (MIME text/html), strict MIME checking refuses to execute
// it, and the page is a blank screen on refresh. `output.publicPath:'/'` makes
// the host HTML inject `/main.[hash].js`. This guard fails the build if the
// emitted index.html ever regresses to a relative script src.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'host', 'dist');
const htmlFiles = readdirSync(dist).filter((f) => f.endsWith('.html'));

let ok = true;
for (const file of htmlFiles) {
  const html = readFileSync(join(dist, file), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  const relative = scripts.filter((src) => !src.startsWith('/') && !/^https?:/.test(src));
  if (relative.length) {
    ok = false;
    console.error(`[check-absolute-src] FAIL: ${file} has RELATIVE script src: ${relative.join(', ')}`);
  } else {
    console.log(`[check-absolute-src] OK: ${file} scripts (${scripts.join(', ')})`);
  }
}

if (!ok) {
  console.error(
    '[check-absolute-src] Set output.publicPath = "/" in frontend/host/webpack.config.js so deep-route refreshes load the bundle.'
  );
  process.exit(1);
}
