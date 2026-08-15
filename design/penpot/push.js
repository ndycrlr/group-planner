// code -> Penpot. The body of the payload; `scripts/design-push.mjs` puts the
// contract in front of it as a `CONTRACT` const and prints the result to paste
// into the Penpot connector's `execute_code`.
//
//   npm run design:push > payload.js
//
// SCOPE: foundations only — the design tokens and the typographies. It does not
// redraw the six page boards. Those are illustrations built out of the
// foundations rather than a second copy of them, and rebuilding one is a
// several-call job by hand (CLAUDE.md explains why long `execute_code` calls
// are the thing that drops the plugin connection). When a page's layout really
// changes, redraw that board; when a colour or a type size changes, this is
// enough, because the boards reference the same library styles.
//
// Idempotent: run it twice and the second run reports every value as unchanged.

const SET_OF_THEME = { light: 'Daylight/Light', dark: 'Daylight/Dark' };

/** CSS custom property -> Penpot token, with the unit conversion each needs. */
const TOKEN_MAP = {
  morning: ['colour.morning', 'color', (v) => v.toUpperCase()],
  afternoon: ['colour.afternoon', 'color', (v) => v.toUpperCase()],
  evening: ['colour.evening', 'color', (v) => v.toUpperCase()],
  paper: ['colour.paper', 'color', (v) => v.toUpperCase()],
  card: ['colour.card', 'color', (v) => v.toUpperCase()],
  ink: ['colour.ink', 'color', (v) => v.toUpperCase()],
  muted: ['colour.muted', 'color', (v) => v.toUpperCase()],
  line: ['colour.line', 'color', (v) => v.toUpperCase()],
  danger: ['colour.danger', 'color', (v) => v.toUpperCase()],
  'danger-bg': ['colour.dangerBg', 'color', (v) => v.toUpperCase()],
  'lit-max': ['lit.max', 'opacity', (v) => String(Number(v.replace('%', '')) / 100)],
  radius: ['radius.card', 'borderRadius', (v) => String(parseFloat(v))],
  'radius-sm': ['radius.control', 'borderRadius', (v) => String(parseFloat(v))],
  // Only the typeface travels, never the fallback stack: Penpot parses a font
  // token into a list of families and rejects `-apple-system` outright.
  display: ['font.display', 'fontFamilies', (v) => firstFamily(v)],
  body: ['font.body', 'fontFamilies', (v) => firstFamily(v)],
};

function firstFamily(stack) {
  return stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
}

/** Contract style name -> the typography's name in the Penpot library. */
const TYPE_MAP = {
  h1: 'h1',
  h2: 'Card title',
  eyebrow: 'Label (tracked caps)',
  subtitle: 'Subtitle',
  hint: 'Hint',
  body: 'Base',
  count: 'Count',
  stripPart: 'Strip part',
};

const changed = [];
const unchanged = [];
const refused = [];

// --- Tokens --------------------------------------------------------------

const catalog = penpot.library.local.tokens;
const setsByName = Object.fromEntries(catalog.sets.map((s) => [s.name, s]));

for (const [theme, setName] of Object.entries(SET_OF_THEME)) {
  const set = setsByName[setName];
  if (!set) {
    refused.push(`no token set named ${setName}`);
    continue;
  }
  const tokens = CONTRACT.themes[theme].tokens;

  for (const [cssName, [tokenName, type, convert]] of Object.entries(TOKEN_MAP)) {
    const cssValue = tokens[cssName];
    if (cssValue === undefined) continue;
    const wanted = convert(cssValue);
    const existing = set.tokens.find((t) => t.name === tokenName);

    try {
      if (!existing) {
        set.addToken({ type, name: tokenName, value: wanted });
        changed.push(`+ ${setName}/${tokenName} = ${wanted}`);
      } else if (String(existing.value) !== wanted) {
        const before = existing.value;
        existing.value = wanted;
        changed.push(`~ ${setName}/${tokenName}: ${before} -> ${wanted}`);
      } else {
        unchanged.push(`${setName}/${tokenName}`);
      }
    } catch (error) {
      refused.push(`${setName}/${tokenName} = ${wanted}: ${error.message}`);
    }
  }
}

// --- Typographies --------------------------------------------------------
//
// Type is a property of the design system rather than of a theme, so it is
// taken from the light contract; the two themes share every metric.

const library = penpot.library.local;
const type = CONTRACT.themes.light.type;

for (const [contractName, penpotName] of Object.entries(TYPE_MAP)) {
  const style = type[contractName];
  if (!style) continue;

  let target = library.typographies.find((t) => t.name === penpotName);
  if (!target) {
    target = library.createTypography();
    target.name = penpotName;
    changed.push(`+ typography ${penpotName}`);
  }

  const size = parseFloat(style.fontSize);
  const wanted = {
    fontFamily: firstFamily(style.fontFamily),
    fontSize: String(size),
    fontWeight: String(style.fontWeight),
    // Penpot's line height is a ratio of the font size, not a pixel value.
    // Passing the CSS px straight through sets a line box that many times the
    // size — a 52px line height becomes 52 lines tall.
    lineHeight: String(+(parseFloat(style.lineHeight) / size).toFixed(3)),
    letterSpacing: style.letterSpacing === 'normal'
      ? '0'
      : String(parseFloat(style.letterSpacing)),
  };

  for (const [field, value] of Object.entries(wanted)) {
    if (String(target[field]) === value) {
      unchanged.push(`${penpotName}.${field}`);
      continue;
    }
    // Negative tracking is rejected rather than clamped, so it cannot travel.
    // Recording the intent on the layer name is the agreed substitute; dropping
    // it silently is what this guards against.
    if (field === 'letterSpacing' && parseFloat(value) < 0) {
      refused.push(`${penpotName}.letterSpacing = ${value} (Penpot rejects negative tracking; `
        + 'keep it on the layer name)');
      continue;
    }
    try {
      target[field] = value;
      changed.push(`~ ${penpotName}.${field} = ${value}`);
    } catch (error) {
      refused.push(`${penpotName}.${field} = ${value}: ${error.message}`);
    }
  }
}

return {
  changed,
  refused,
  unchangedCount: unchanged.length,
  summary: `${changed.length} changed, ${refused.length} refused, ${unchanged.length} already correct`,
};
