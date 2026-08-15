// Rewrite design/design.json from the running app.
//
// This delegates to Playwright rather than driving a browser itself, so the
// extraction runs against exactly the same server, database and viewport as the
// check in `npm test` does. Two code paths producing that file would eventually
// disagree, and the disagreement would look like a design change.
//
// It is a script rather than a bare env var in package.json because
// `DESIGN_WRITE=1 playwright test` is not valid on Windows `cmd`, which is what
// npm runs scripts through there.

import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  ['playwright', 'test', 'tests/design.spec.js', '--reporter=list'],
  {
    stdio: 'inherit',
    env: { ...process.env, DESIGN_WRITE: '1' },
    // npx is a shell script on POSIX and a .cmd on Windows; neither is directly
    // executable without a shell.
    shell: true,
  },
);

if (result.status !== 0) {
  console.error('\nExtraction failed — design/design.json was not updated.');
}
process.exit(result.status ?? 1);
