import fs from 'fs';
import path from 'path';

/**
 * FIX 1 regression (fresh review, CRITICAL): the Module Federation EXPOSED
 * module is `./src/App` (webpack.config.js), so the global stylesheet MUST be
 * imported from App.jsx. index.js/bootstrap never run when the host composes
 * the remote at /requester — only the exposed App graph loads. If the CSS
 * import leaves App.jsx, the composed UI renders UNSTYLED while every suite
 * stays green (standalone dev on :3001 loads its own CSS and masks the bug).
 *
 * Static source assertion: deterministic, runs in every CI suite, and fails
 * exactly when this regression returns. The live-composed styling is verified
 * manually (see MANUAL-TESTING.md, "PR #6 — requester panel (frontend)").
 */
describe('remote CSS ships through the exposed module graph (FIX 1)', () => {
  test('the MF-exposed App module imports the global stylesheet', () => {
    const appSource = fs.readFileSync(
      path.join(__dirname, 'App.jsx'),
      'utf8'
    );
    expect(appSource).toMatch(
      /import\s+['"]\.\/globals\.css['"]/
    );
  });

  test('index.js does not duplicate the CSS import (single source: App.jsx)', () => {
    const indexSource = fs.readFileSync(
      path.join(__dirname, 'index.js'),
      'utf8'
    );
    expect(indexSource).not.toMatch(/import\s+['"]\.\/globals\.css['"]/);
  });
});
