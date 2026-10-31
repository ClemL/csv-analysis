# CLAUDE.md

CSV Inspector: a Next.js App Router app that parses and profiles delimited
files entirely in the browser, also packaged as an Electron desktop app. See
`README.md` for the features and the project layout.

## Working agreements

* **Add a line to `public/updates.txt` when you ship a user-visible change.** Newest last; the footer reads the file and shows the final line. Internal changes (refactors, tests, tooling) do not get a line.
* Before pushing, run `npm run typecheck`, `npm test` and `npm run build`. CI runs the same, plus the desktop export (`DESKTOP_BUILD=1 npx next build`).
* Keep the app free of runtime dependencies beyond React and Next.js, and keep it local: nothing a user pastes or opens leaves the browser.
