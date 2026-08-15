// Penpot -> code. Paste the whole of this file into the Penpot connector's
// `execute_code` tool, then save what it returns to design/penpot/pulled.json
// and run `npm run design:diff`.
//
// It reports the design file in the *contract's* vocabulary — CSS token names,
// CSS units — so the comparison is like for like and the translation lives in
// one place rather than being reinvented on both sides. `design/README.md` has
// the routine around it.
//
// The design tokens are the source read here, not the library colours: the two
// palettes are separate token sets (`Daylight/Light`, `Daylight/Dark`), whereas
// the library has two colours called `morning` and nothing to say which theme
// each belongs to.

const SET_THEME = {
  'Daylight/Light': 'light',
  'Daylight/Dark': 'dark',
};

// Penpot token name -> CSS custom property, with the unit conversion each needs.
// Anything absent from this map is reported as `penpotOnly` rather than being
// silently dropped: a token the designer added is a change worth seeing.
const TOKEN_MAP = {
  'colour.morning': ['morning', (v) => v.toLowerCase()],
  'colour.afternoon': ['afternoon', (v) => v.toLowerCase()],
  'colour.evening': ['evening', (v) => v.toLowerCase()],
  'colour.paper': ['paper', (v) => v.toLowerCase()],
  'colour.card': ['card', (v) => v.toLowerCase()],
  'colour.ink': ['ink', (v) => v.toLowerCase()],
  'colour.muted': ['muted', (v) => v.toLowerCase()],
  'colour.line': ['line', (v) => v.toLowerCase()],
  'colour.danger': ['danger', (v) => v.toLowerCase()],
  'colour.dangerBg': ['danger-bg', (v) => v.toLowerCase()],
  // The contract carries this as the CSS percentage it is declared as.
  'lit.max': ['lit-max', (v) => `${Math.round(Number(v) * 100)}%`],
  'radius.card': ['radius', (v) => `${Number(v)}px`],
  'radius.control': ['radius-sm', (v) => `${Number(v)}px`],
  // Only the typeface, never the fallback stack — see the note below.
  'font.display': ['display', (v) => v],
  'font.body': ['body', (v) => v],
};

// Penpot stores a font token as a parsed list of families and rejects a member
// beginning with a hyphen, so `-apple-system` makes the full CSS stack
// unstorable. Storing only the first family is the better answer anyway: which
// typeface to use is a design decision, whereas what to fall back to when it
// has not downloaded is a code one. `scripts/design-diff.mjs` compares these
// two on the leading family alone for the same reason.

const catalog = penpot.library.local.tokens;

const themes = {};
const penpotOnly = {};

for (const set of catalog.sets) {
  const theme = SET_THEME[set.name];
  if (!theme) {
    penpotOnly[set.name] = set.tokens.map((t) => t.name);
    continue;
  }
  const tokens = {};
  const extra = [];
  for (const token of set.tokens) {
    const mapped = TOKEN_MAP[token.name];
    if (!mapped) {
      extra.push(`${token.name} = ${token.value}`);
      continue;
    }
    const [cssName, convert] = mapped;
    tokens[cssName] = convert(String(token.value));
  }
  themes[theme] = { tokens };
  if (extra.length) penpotOnly[set.name] = extra;
}

// Typographies, named as the contract names them so a renamed or retuned style
// lands next to its CSS counterpart. `lineHeight` is a ratio in Penpot and px
// in CSS; it is converted here so the diff never has to know that.
const TYPE_MAP = {
  h1: 'h1',
  'Card title': 'h2',
  'Label (tracked caps)': 'eyebrow',
  Subtitle: 'subtitle',
  Hint: 'hint',
  Base: 'body',
  Count: 'count',
  'Strip part': 'stripPart',
  // No CSS counterpart: this is the heading style used by the Foundations
  // board itself, so the diff reports it as design-only and that is correct.
  Section: 'section',
};

const type = {};
for (const style of penpot.library.local.typographies) {
  const name = TYPE_MAP[style.name] ?? style.name;
  const size = Number(style.fontSize);
  type[name] = {
    fontFamily: style.fontFamily,
    fontSize: `${size}px`,
    fontWeight: String(style.fontWeight),
    lineHeight: `${+(Number(style.lineHeight) * size).toFixed(2)}px`,
    letterSpacing: `${Number(style.letterSpacing)}px`,
  };
}

// The variant inventory. A designer adding a slot state shows up here as a
// member the code has no branch for, which is the whole Penpot -> code signal.
const components = {};
for (const board of penpot.currentPage.findShapes({ type: 'board' })) {
  if (!board.variants) continue;
  components[board.name] = board.variants.variantComponents()
    .map((v) => Object.entries(v.variantProps || {})
      .map(([key, value]) => `${key}=${value}`)
      .join(', '))
    .sort();
}

return { themes, type, components, penpotOnly };
