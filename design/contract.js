// The design contract: what "the Daylight design" is, in values rather than pixels.
//
// Both directions of the Penpot loop compare against this one shape.
//   code   -> `npm run design:extract` re-reads it from the running app
//   Penpot -> design/penpot/pull.js returns the same shape from the design file
//   drift  -> tests/design.spec.js fails when the app stops matching the committed copy
//
// WHAT GOES IN HERE, AND WHAT DELIBERATELY DOES NOT
//
// Only values CSS resolves on its own: token values, declared type metrics,
// box styling, and the media-query conditions. Never a measured width, height
// or text extent. The web fonts come from Google Fonts over the network, so a
// run with no network falls back to a system face and every text measurement
// moves — a contract built on those would fail for a reason that has nothing to
// do with the design. Everything recorded below computes identically whether or
// not Bricolage Grotesque ever arrives.
//
// Colours come back as whatever string the browser computes, `color-mix()` and
// all. That is deterministic for a pinned Chromium, which is what makes it a
// drift signal; it is NOT how a colour reaches Penpot. A slot's fill is
// reproduced there as the hue at `lit x --lit-max` opacity, which is exact and
// needs no mixed value. See design/README.md.

/** The custom properties on `:root` that the whole palette hangs off. */
export const TOKENS = [
  'paper', 'card', 'ink', 'muted', 'line',
  'morning', 'afternoon', 'evening',
  'danger', 'danger-bg',
  'lit-max', 'radius', 'radius-sm',
  'display', 'body',
];

export const PARTS = ['morning', 'afternoon', 'evening'];

/**
 * The share-of-group-free steps the ladder is sampled at: 0/4 through 4/4.
 *
 * Labelled `n/4` rather than `0.25`, because a key like `"0"` or `"1"` is an
 * array index as far as JS object ordering is concerned and would be hoisted
 * above the fractions — leaving the ladder written to disk out of order.
 */
export const LIT_STEPS = [0, 0.25, 0.5, 0.75, 1];
export const litLabel = (step) => `${step * 4}/4`;

/** Type is read at one fixed width because `h1` is a `clamp()` on `vw`. */
export const TYPE_VIEWPORT = { width: 1200, height: 900 };

const TYPE_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight',
  'lineHeight', 'letterSpacing', 'textTransform',
];

const BOX_PROPS = [
  'backgroundColor', 'color', 'borderStyle', 'borderWidth', 'borderColor',
  'borderRadius', 'padding', 'minHeight', 'fontSize', 'fontWeight',
];

/**
 * Probes are built from markup rather than found on a page, so the contract
 * covers every state — including ones no page shows at rest, like a selected
 * slot or a unanimous cell.
 *
 * `pick` selects the element to measure when the outer element is only there to
 * satisfy a descendant selector (`.cell .count`, `.card h2`).
 */
const TYPE_PROBES = [
  { name: 'h1', html: '<h1>Ag</h1>' },
  { name: 'h2', html: '<section class="card"><h2>Ag</h2></section>', pick: 'h2' },
  { name: 'eyebrow', html: '<p class="eyebrow">Ag</p>' },
  { name: 'subtitle', html: '<p class="subtitle">Ag</p>' },
  { name: 'hint', html: '<p class="hint">Ag</p>' },
  { name: 'body', html: '<p>Ag</p>' },
  {
    name: 'count',
    html: '<div class="cell" data-part="morning"><span class="count">2/4</span></div>',
    pick: '.count',
  },
  {
    name: 'stripPart',
    html: '<div class="cell strip" data-part="morning"><span class="part">M</span></div>',
    pick: '.part',
  },
];

/**
 * Read the whole contract out of a live page.
 *
 * Runs entirely in the browser so the values are the ones the cascade actually
 * produced, not a re-reading of the stylesheet. The caller supplies the theme,
 * via `page.emulateMedia({ colorScheme })`.
 */
export async function readTheme(page) {
  return page.evaluate(
    ({ TOKENS, PARTS, LIT_STEPS, TYPE_PROBES, TYPE_PROPS, BOX_PROPS }) => {
      const scratch = document.createElement('div');
      // Off-screen rather than `display: none`: a hidden subtree still computes
      // most properties, but keeping it laid out avoids depending on which.
      scratch.style.cssText = 'position:absolute;left:-9999px;top:0;width:200px';
      document.body.append(scratch);

      const pickProps = (element, props) => {
        const computed = getComputedStyle(element);
        const out = {};
        for (const prop of props) out[prop] = computed[prop];
        return out;
      };

      /** Build one probe, measure it, and take it away again. */
      const probe = (html, selector, props) => {
        scratch.innerHTML = html;
        const element = selector
          ? scratch.querySelector(selector)
          : scratch.firstElementChild;
        const out = pickProps(element, props);
        scratch.innerHTML = '';
        return out;
      };

      const root = getComputedStyle(document.documentElement);
      const tokens = {};
      for (const token of TOKENS) {
        tokens[token] = root.getPropertyValue(`--${token}`).trim();
      }

      const type = {};
      for (const { name, html, pick } of TYPE_PROBES) {
        type[name] = probe(html, pick, TYPE_PROPS);
      }

      // The two-channel contract: hue says which part of the day, brightness
      // says how much of the group is free. Sampled per part at every step so a
      // change to either channel shows up as a changed row.
      const lit = {};
      for (const part of PARTS) {
        lit[part] = {};
        for (const step of LIT_STEPS) {
          scratch.innerHTML = `<div class="cell" data-part="${part}" style="--lit:${step}"></div>`;
          lit[part][`${step * 4}/4`] = getComputedStyle(scratch.firstElementChild).backgroundColor;
          scratch.innerHTML = '';
        }
      }

      const components = {
        pickFree: probe('<button class="pick" data-part="morning">Morning</button>', null, BOX_PROPS),
        pickSelected: probe(
          '<button class="pick" data-part="morning" aria-pressed="true">✓ Available</button>',
          null, BOX_PROPS,
        ),
        pickStrip: probe('<button class="pick strip" data-part="morning">M</button>', null, BOX_PROPS),
        cellEmpty: probe('<div class="cell" data-part="morning" style="--lit:0"></div>', null, BOX_PROPS),
        cellAll: probe(
          '<div class="cell all-available" data-part="morning" style="--lit:1"></div>',
          null, BOX_PROPS,
        ),
        card: probe('<section class="card"></section>', null, BOX_PROPS),
      };

      // The narrow-screen rules are part of the design, not an implementation
      // detail: they are the whole answer to "neither grid may scroll sideways".
      // Reading them from the CSSOM means a moved breakpoint is a failed test.
      const media = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // A cross-origin sheet (the Google Fonts one) refuses this.
        }
        for (const rule of rules) {
          if (rule.media) media.push(rule.conditionText ?? rule.media.mediaText);
        }
      }

      scratch.remove();
      return { tokens, type, lit, components, media };
    },
    { TOKENS, PARTS, LIT_STEPS, TYPE_PROBES, TYPE_PROPS, BOX_PROPS },
  );
}

/**
 * Both themes, in the order they are written to disk.
 *
 * Key order is fixed rather than incidental: the committed file is compared
 * byte for byte, so a reshuffle would read as a design change.
 */
export async function readContract(page, gotoBase) {
  await page.setViewportSize(TYPE_VIEWPORT);
  await page.goto(`${gotoBase}/index.html`);
  // Web fonts change no value in the contract, but waiting makes the run
  // identical with and without a warm cache.
  await page.evaluate(() => document.fonts.ready);

  const themes = {};
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    themes[colorScheme] = await readTheme(page);
  }
  await page.emulateMedia({ colorScheme: null });

  // `media` is identical in both themes and is about layout, not palette, so it
  // is lifted out rather than stored twice.
  const media = themes.light.media;
  delete themes.light.media;
  delete themes.dark.media;

  return {
    note: 'Generated by `npm run design:extract`. Do not hand-edit — see design/README.md.',
    viewport: TYPE_VIEWPORT,
    media,
    themes,
  };
}

/** Stable serialisation, so an unchanged design produces an unchanged file. */
export function serialise(contract) {
  return `${JSON.stringify(contract, null, 2)}\n`;
}
