# CLAUDE.md

CSV Inspector: a Next.js App Router app that parses and profiles delimited
files entirely in the browser, also packaged as an Electron desktop app. See
`README.md` for the features and the project layout.

## Working agreements

* **Add a line to `public/updates.txt` when you ship a user-visible change.** Newest last; the footer reads the file and shows the final line. Internal changes (refactors, tests, tooling) do not get a line.
* **Check UI work at the four device sizes**: OnePlus Open folded (425×946) and unfolded (864×930), Galaxy Tab S Ultra portrait (924×1480) and landscape (1480×924). The device tests run them; if a real device reports other figures (the changelog dialog shows them under "This screen"), correct the tests in `e2e/screens.ts`.
* Before pushing, run `npm run typecheck`, `npm test`, `npm run build` and then `npm run test:e2e` (the browser tests run against that build). CI runs the same, plus the desktop export (`DESKTOP_BUILD=1 npx next build`).
* Keep the app free of runtime dependencies beyond React and Next.js, and keep it local: nothing a user pastes or opens leaves the browser.
