# The Penpot loop

Design work happens in Penpot, in the file **Group Booking**, and moves in both
directions. This directory is what makes "both directions" mean something more
than good intentions: a single machine-readable contract that each side is
compared against, rather than two people looking at a screenshot.

```
public/styles.css ──extract──► design/design.json ──push──► Penpot "Group Booking"
        ▲                            ▲     │                          │
        └──── you edit the CSS ──────┘     └────────diff◄─────pull─────┘
```

| File | What it is |
| --- | --- |
| `design.json` | The contract. Generated — never hand-edited. |
| `contract.js` | What the contract contains, and how it is read from a page. |
| `penpot/push.js` | code → Penpot. Applies the contract to the design file's tokens and typographies. |
| `penpot/pull.js` | Penpot → code. Reports the design file in the contract's vocabulary. |
| `penpot/pulled.json` | The last pull, committed so `design:diff` works without opening Penpot. |

## The four commands

```sh
npm run design:extract   # re-read the contract from the running app
npm test                 # among other things, fail if the app has drifted from it
npm run design:push      # print the payload that applies the contract to Penpot
npm run design:diff      # compare the last Penpot pull against the contract
```

## Adding a feature in code

`tests/design.spec.js` re-extracts the contract on every test run and compares
it to the committed copy, so **a change to the design system fails the suite**.
That failure is the notification; there is nothing to remember to do.

```sh
# 1. edit public/styles.css
npm test                 # fails, naming the values that moved
npm run design:extract   # accept them into the contract
npm run design:push      # paste the output into the Penpot connector's execute_code
```

The push covers the foundations — the design tokens and the typographies. It
does **not** redraw the six page boards, because those are illustrations built
out of the foundations rather than a second copy of them; they pick up a changed
colour or type size through the library. When a page's *layout* changes, redraw
that board by hand, in several modest `execute_code` calls (see CLAUDE.md for
why one long call is the thing that drops the plugin connection).

## Taking a change from Penpot

There is no webhook and no polling: the connector is a handle on an open browser
tab, so the pull is something a person or an agent runs, not a background job.

1. Open the Penpot MCP Plugin in the **Group Booking** tab.
2. Run the contents of `penpot/pull.js` through the connector's `execute_code`.
3. Save what it returns to `penpot/pulled.json`.
4. `npm run design:diff`.

The report has four sections, and the distinction between them is the point:

- **values differ** — the design file and the code disagree. Someone decides.
- **in the code, not in Penpot** — usually a token the design has no opinion on.
- **in Penpot, not in the code** — a design decision with no implementation yet.
- **Penpot cannot represent** — not anyone's to fix; listed so a real change
  cannot hide behind a known limitation.

`design:diff` always exits 0. A difference is a conversation about who is right,
not a build failure — and it runs against a file a human pasted out of a
browser, which is not something CI could reproduce. Drift *within the code* is
the part that is enforced, and that is `npm test`'s job.

## What the contract holds, and what it deliberately does not

Only values CSS resolves by itself: the `:root` tokens, declared type metrics,
component box styling, and the media-query conditions. **No measured widths,
heights or text extents.** The web fonts load from Google Fonts over the
network, so a run with no network falls back to a system face and every text
measurement moves — a contract built on those would fail for reasons that have
nothing to do with the design.

Colours are recorded as whatever string the browser computed, `color-mix()` and
all. That is deterministic for a pinned Chromium, which is what makes it a drift
signal — but it is *not* how a colour reaches Penpot. A slot's fill is
reproduced there as **the hue at `lit × --lit-max` opacity**, which is exact and
needs no mixed value. The contract happens to prove that rule holds: with
`--lit-max: 76%`, the ladder's alphas come out 0.19, 0.38, 0.57, 0.76.
`design:diff` re-derives those from the Penpot token and checks them, so a flat
fill pasted over a slot in the design file is caught rather than admired.

## Known gaps

- **Negative letter-spacing cannot travel.** Penpot rejects it outright rather
  than clamping, so the display face's tracking (`-1.24px` on `h1`, `-0.324px`
  on card titles) stays at 0 in the design file, with the intended value on the
  layer name. Both tools report it under "cannot represent".
- **Font tokens carry the typeface, not the stack.** Penpot parses a font token
  into a list of families and refuses `-apple-system`. Which typeface to use is
  a design decision; what to fall back to before it downloads is a code one, so
  only the leading family is compared.
- **The page boards are light-theme only.** Both palettes exist in Foundations,
  the library and the token sets; the six page mockups render light.
