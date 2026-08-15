// The code half of the Penpot loop: does the app still look like the contract?
//
// Two modes, one extraction path — deliberately, so the file this writes and
// the file it later checks can never differ because they were produced
// differently:
//
//   npm run design:extract   DESIGN_WRITE=1, rewrites design/design.json
//   npm test                 compares the app against the committed copy
//
// A failure here is not a bug. It means a change to the CSS moved the design
// system, and the Penpot file has not been told. The fix is to look at the diff,
// decide whether it was intended, then re-extract and push it to Penpot
// (design/README.md has the routine).

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readContract, serialise } from '../design/contract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_FILE = path.join(here, '..', 'design', 'design.json');

const writing = process.env.DESIGN_WRITE === '1';

test.describe('design contract', () => {
  // The contract is a property of the stylesheet, not of any one event, so
  // there is nothing to set up and nothing to tidy away.
  test('the app matches design/design.json', async ({ page, baseURL }) => {
    const actual = await readContract(page, baseURL);

    if (writing) {
      fs.mkdirSync(path.dirname(CONTRACT_FILE), { recursive: true });
      fs.writeFileSync(CONTRACT_FILE, serialise(actual));
      console.log(`wrote ${CONTRACT_FILE}`);
      return;
    }

    expect(
      fs.existsSync(CONTRACT_FILE),
      'design/design.json is missing — run `npm run design:extract`',
    ).toBe(true);

    const committed = JSON.parse(fs.readFileSync(CONTRACT_FILE, 'utf8'));

    // Compared as objects rather than as text: the failure output then names
    // the token that moved instead of a line number in a generated file.
    expect(
      actual,
      'The design has moved away from design/design.json. If that was intended, '
        + 'run `npm run design:extract` and push the change to Penpot — see design/README.md.',
    ).toEqual(committed);
  });

  // Guards the invariant that a picture cannot carry: a board drawn at desktop
  // width says nothing about 320px, so the breakpoints have to be asserted
  // rather than inferred from the design.
  test('both narrow-screen breakpoints are still in place', async ({ page, baseURL }) => {
    const { media } = await readContract(page, baseURL);
    expect(media).toContain('(max-width: 44rem)'); // list grid reflows
    expect(media).toContain('(max-width: 48rem)'); // month grid drops min-width
  });
});
