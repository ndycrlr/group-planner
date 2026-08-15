// Compare the Penpot file against the code's design contract.
//
//   npm run design:diff [pulled.json]
//
// The input is whatever design/penpot/pull.js returned, saved to disk. Both
// sides are already in the contract's vocabulary by the time they get here, so
// this file only has to compare and explain — the translation lives in pull.js.
//
// Exit status is 0 whether or not anything differs. A difference is a
// conversation ("who is right, the design or the code?"), not a build failure,
// and this runs against a file a human pasted out of a browser rather than
// against anything CI could reproduce. The drift *within* the code is what
// `npm test` enforces; see tests/design.spec.js.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const contractFile = path.join(root, 'design', 'design.json');
const pulledFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'design', 'penpot', 'pulled.json');

for (const [label, file] of [['contract', contractFile], ['Penpot pull', pulledFile]]) {
  if (!fs.existsSync(file)) {
    console.error(`No ${label} at ${file}`);
    if (file === contractFile) console.error('Run `npm run design:extract` first.');
    else console.error('Run design/penpot/pull.js in the Penpot connector and save the result there.');
    process.exit(1);
  }
}

const contract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
const penpot = JSON.parse(fs.readFileSync(pulledFile, 'utf8'));

/**
 * Differences Penpot cannot express, and which are therefore not anybody's to
 * fix. They are still listed — silently dropping them would let a real change
 * hide behind a known one — but under their own heading, so the rows that do
 * need a decision are not read past.
 *
 * Negative letter-spacing is rejected outright by the Penpot API rather than
 * clamped, so the display face's tracking cannot travel. The layers carry the
 * intended value in their name instead.
 */
const KNOWN_LIMITS = new Map([
  ['type/h1.letterSpacing', 'Penpot rejects negative letterSpacing'],
  ['type/h2.letterSpacing', 'Penpot rejects negative letterSpacing'],
]);

/** Styles that exist only to label the design file itself. */
const DESIGN_ONLY_BY_DESIGN = new Set(['type/section']);

/** Collected rather than printed as we go, so the report can be grouped. */
const differs = [];
const codeOnly = [];
const designOnly = [];
const known = [];

// --- Tokens --------------------------------------------------------------

const FONT_TOKENS = new Set(['display', 'body']);

/** `'"Instrument Sans", system-ui, sans-serif'` -> `'instrument sans'`. */
const firstFamily = (stack) =>
  stack.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();

for (const theme of ['light', 'dark']) {
  const fromCode = contract.themes?.[theme]?.tokens ?? {};
  const fromDesign = penpot.themes?.[theme]?.tokens ?? {};

  for (const [name, codeValue] of Object.entries(fromCode)) {
    const designValue = fromDesign[name];
    if (designValue === undefined) {
      codeOnly.push(`${theme}/--${name} = ${codeValue}`);
      continue;
    }
    // A font token names the typeface; the rest of the CSS stack says what to
    // render before it arrives, which is not the design file's business — and
    // could not be stored there anyway, since Penpot rejects `-apple-system`.
    const compare = FONT_TOKENS.has(name) ? firstFamily : (v) => v.toLowerCase();
    if (compare(designValue) !== compare(codeValue)) {
      differs.push({ what: `${theme}/--${name}`, code: codeValue, design: designValue });
    }
  }
  for (const name of Object.keys(fromDesign)) {
    if (!(name in fromCode)) designOnly.push(`${theme}/--${name} = ${fromDesign[name]}`);
  }
}

// --- The lit ladder ------------------------------------------------------
//
// Penpot does not store the ladder; it reproduces it, as the hue at
// `lit x --lit-max` opacity. So the check is not "are these colours equal" but
// "does the rule still hold" — recompute the alpha the design would produce and
// hold it against the alpha the browser actually rendered. That is the one
// invariant a flat fill in a design file is most likely to quietly break.

const alphaOf = (value) => {
  const match = /\/\s*([0-9.]+)\s*\)/.exec(value);
  return match ? Number(match[1]) : (value.includes('/ 0)') ? 0 : null);
};

for (const theme of ['light', 'dark']) {
  const litMax = penpot.themes?.[theme]?.tokens?.['lit-max'];
  if (!litMax) continue;
  const max = Number(litMax.replace('%', '')) / 100;

  for (const [part, steps] of Object.entries(contract.themes?.[theme]?.lit ?? {})) {
    for (const [label, rendered] of Object.entries(steps)) {
      const lit = Number(label.split('/')[0]) / 4;
      const expected = +(lit * max).toFixed(4);
      const actual = alphaOf(rendered);
      if (actual === null) continue;
      if (Math.abs(actual - expected) > 0.005) {
        differs.push({
          what: `${theme}/lit ${part} ${label}`,
          code: `alpha ${actual}`,
          design: `alpha ${expected} (lit ${lit} x lit-max ${max})`,
        });
      }
    }
  }
}

// --- Type ----------------------------------------------------------------

const TYPE_FIELDS = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];

// Penpot stores line height as a ratio of the font size, so converting back to
// px cannot always land on the browser's value exactly — 1.55 x 16.32 is
// 25.296, and the ratio only survives to two decimals. A twentieth of a pixel
// is the representational limit, not a design decision, and reporting it as one
// would bury the rows that matter.
const PX_TOLERANCE = 0.05;

const px = (value) => {
  const match = /^(-?[0-9.]+)px$/.exec(value);
  return match ? Number(match[1]) : null;
};

// `normal` is CSS's way of saying "no tracking"; Penpot writes it as 0px.
const norm = (value) => (value === 'normal' ? '0px' : value);

function sameValue(a, b) {
  if (norm(a) === norm(b)) return true;
  const [left, right] = [px(norm(a)), px(norm(b))];
  return left !== null && right !== null && Math.abs(left - right) <= PX_TOLERANCE;
}

for (const [name, codeStyle] of Object.entries(contract.themes?.light?.type ?? {})) {
  const designStyle = penpot.type?.[name];
  if (!designStyle) {
    codeOnly.push(`type/${name}`);
    continue;
  }
  for (const field of TYPE_FIELDS) {
    const codeValue = codeStyle[field];
    const designValue = designStyle[field];
    if (codeValue === undefined || designValue === undefined) continue;
    if (sameValue(codeValue, designValue)) continue;
    const what = `type/${name}.${field}`;
    const limit = KNOWN_LIMITS.get(what);
    if (limit) known.push({ what, code: codeValue, design: designValue, why: limit });
    else differs.push({ what, code: codeValue, design: designValue });
  }
}
for (const name of Object.keys(penpot.type ?? {})) {
  if (name in (contract.themes?.light?.type ?? {})) continue;
  if (DESIGN_ONLY_BY_DESIGN.has(`type/${name}`)) continue;
  designOnly.push(`type/${name}`);
}

// --- Report --------------------------------------------------------------

const heading = (text) => `\n${text}\n${'-'.repeat(text.length)}`;

console.log(`contract   ${path.relative(root, contractFile)}`);
console.log(`Penpot     ${path.relative(root, pulledFile)}`);

if (differs.length) {
  console.log(heading(
    differs.length === 1 ? '1 value differs' : `${differs.length} values differ`,
  ));
  const width = Math.max(...differs.map((d) => d.what.length));
  for (const { what, code, design } of differs) {
    console.log(`  ${what.padEnd(width)}   code ${code}   penpot ${design}`);
  }
}

if (codeOnly.length) {
  console.log(heading(`${codeOnly.length} in the code, not in Penpot`));
  for (const item of codeOnly) console.log(`  ${item}`);
}

if (designOnly.length) {
  console.log(heading(`${designOnly.length} in Penpot, not in the code`));
  for (const item of designOnly) console.log(`  ${item}`);
}

if (penpot.components) {
  console.log(heading('Component variants in Penpot'));
  for (const [name, members] of Object.entries(penpot.components)) {
    console.log(`  ${name} — ${members.length} variants`);
  }
  console.log('  (a variant with no branch in the code is a design change to implement)');
}

if (known.length) {
  console.log(heading(`${known.length} Penpot cannot represent`));
  const width = Math.max(...known.map((k) => k.what.length));
  for (const { what, code, design, why } of known) {
    console.log(`  ${what.padEnd(width)}   code ${code}   penpot ${design}   (${why})`);
  }
}

if (!differs.length && !codeOnly.length && !designOnly.length) {
  console.log('\nNothing to decide. The design file and the code agree, '
    + 'apart from what Penpot cannot express.');
} else {
  console.log(
    '\nNeither side is automatically right. Decide per row, then either change the CSS'
    + '\nand re-run `npm run design:extract`, or update Penpot with design/penpot/push.js.',
  );
}
