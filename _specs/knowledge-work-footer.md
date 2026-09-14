# Spec for Knowledge Work Footer Link

branch: claude/feature/knowledge-work-footer
figma_component (if used): not used

## Summary
Add a footer to every page of the site holding a permanent link to Knowledge Work at www.knowledgework.co.uk. The footer is fixed to the bottom of the viewport on desktop and on mobile, so the link is visible whatever the page's length and wherever the visitor has scrolled.

## Functional Requirements
- A footer appears on all four pages: create (`index`), pick (`event`), results (`results`) and admin (`admin`).
- The footer stays pinned to the bottom edge of the viewport while the page scrolls, at every screen width from 320px phones up to desktop.
- The footer contains a link to Knowledge Work that goes to `https://www.knowledgework.co.uk`.
- The link text names Knowledge Work clearly (for example "Knowledge Work"), so the destination makes sense without surrounding context or colour.
- The link opens in a new tab and does not give the opened page access to the planner's window.
- The footer never covers page content: the last element on each page (the submit button, the results grid, the admin list) can always be scrolled fully into view above it.
- The footer follows the existing design system: it uses the site's colour tokens, fonts and spacing, and looks right in both the light and dark themes.
- The footer is kept compact, especially on phones, so it takes as little permanent screen height as it can.
- The footer is exposed to assistive technology as the page's footer (content information) landmark, and the link is reachable and visibly focused by keyboard.
- User-facing copy uses British English.
- No new dependencies and no images from other sites; any icon is inline SVG.

## Figma Design Reference (only if referenced)
- File: not referenced. Design work for this project happens in the Penpot file "Group Booking".
- Component name: n/a
- Key visual constraints: if a footer board is later drawn in Penpot, it must still meet the 320px no-sideways-scroll rule and use the theme tokens rather than a flat fill.

## Possible Edge Cases
- Very narrow phones (320px): the footer text must not wrap awkwardly, overflow or cause sideways scrolling.
- iPhones with a home indicator: the footer must clear the bottom safe area rather than sitting underneath it.
- Mobile browsers whose toolbars show and hide on scroll: the footer should stay attached to the visible bottom edge without jumping over content.
- The on-screen keyboard opening while typing a name or email: the footer should not float up and cover the input being typed into.
- Short pages where the content does not fill the screen: the footer still sits at the bottom of the viewport, not directly under the content.
- Long grids (a month view or a long list range) on the event and results pages: the final row and the submit button remain reachable.
- Error or status messages shown near the bottom of a page must not be hidden behind the footer.
- Dark theme and reduced-motion preferences are honoured.
- Browser zoom at 200%: the footer remains legible and does not take over the viewport.
- The admin console when `ADMIN_PASSWORD` is unset: the footer still appears on the "not configured" state.

## Acceptance Criteria
- On each of the four pages, a footer is visible at the bottom of the viewport at both desktop width and 320px width, before and after scrolling to the end.
- The footer contains exactly one link to Knowledge Work, whose destination is `https://www.knowledgework.co.uk`, and it opens in a new tab safely.
- At 320px no page scrolls horizontally, and `tests/mobile.spec.js` still passes.
- On every page, the last interactive element can be scrolled into view and clicked without the footer intercepting the click.
- The footer is readable, with sufficient contrast, in the light and dark themes.
- The footer is a footer landmark and its link can be reached with Tab and shows a visible focus style.
- The full Playwright suite passes. If the design contract test flags the new styles, `design/design.json` is refreshed with `npm run design:extract` and the change is noted for Penpot.
- `README.md` is updated if its layout description mentions the page structure.

## Open Questions
- What exact link text should appear: "Knowledge Work", "Built by Knowledge Work", "A Knowledge Work tool", or something else?
- Should the footer include anything besides the link, such as a logo, copyright line or year?
- Should the link open in a new tab (as assumed above) or in the same tab?
- Should the footer appear on the admin console too, or only on the public pages?
- Is a logo or brand colour for Knowledge Work required, or should the footer use the planner's own styling?
- Should the footer design be drawn in Penpot first, or implemented in code and pushed to Penpot afterwards?

## Testing Guidelines
Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:
- Each of the four pages renders a footer with a link to `https://www.knowledgework.co.uk` that opens in a new tab safely.
- The footer stays within the viewport's bottom edge after scrolling to the end of a long event page, at desktop and at 320px.
- At 320px the page has no horizontal overflow with the footer present.
- The submit button on the event page can be clicked after scrolling to the bottom, meaning the footer does not cover it.
- The footer is exposed as a footer landmark and its link is reachable by keyboard.
