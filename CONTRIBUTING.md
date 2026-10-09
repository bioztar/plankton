# Contributing to PLANkton

PLANkton is a single HTML file built from plain ES modules. There are no runtime dependencies and nothing to install: you need Node 18 or later.

```sh
npm test          # node --test over test/*.test.js
npm run build     # node build.mjs -> dist/plankton.html
npm run check     # fails if dist/plankton.html is stale
```

`dist/plankton.html` is committed: it is the file users download. CI runs the tests, rebuilds, and fails if `dist/` differs from the committed copy, so rebuild and commit it with every source change.

## Layout

| Path | What |
| --- | --- |
| `src/schedule/` | Pure scheduling (no DOM): working-day calendar, link types and lag, auto-schedule, conflicts, cycles, roll-up, critical path |
| `src/model/` | Plan schema and normalisation, flat-row tree operations, edit helpers, options, custom fields, stats, sample plan |
| `src/io/` | Browser storage (`storage.js`, `idb.js`), paste (TSV/CSV) import, CSV export, payload embedding (`standalone.js`), save-in-place (`filesave.js`), version history (`versions.js`) |
| `src/util/` | HTML escaping, markdown → HTML, description sanitizer |
| `src/ui/` | App shell, `grid/`, `gantt/`, `card/`, `board/`, `logs/`, `dialogs/`, print |
| `src/styles/` | CSS, concatenated in file-name order |
| `docs/brand/` | `plankton-logo.svg`, `plankton-mark.svg`, `favicon.svg` |
| `docs/img/` | README screenshots (built-in sample plan only) |
| `build.mjs` | Zero-dependency bundler: resolves the relative named ES imports from `src/main.js`, inlines JS, CSS and the brand artwork into `src/index.html` |

## How a saved file works

The page carries its plan in `<script type="application/json" id="pb-data">`. Save re-emits the page's own HTML with that block filled in (plan, `savedAt`, and the embedded version history). Keep the `pb-data` id: planboard 1.x files use it too.

**Dates** are stored as ISO `YYYY-MM-DD` and handled internally as integer UTC day numbers. `new Date('YYYY-MM-DD')` is never used, so there is no timezone drift. Working days are Monday to Friday, and lag is counted in working days.

## Brand artwork

The build reads `docs/brand/plankton-mark.svg` (header and About dialog, inlined as SVG) and `docs/brand/favicon.svg` (inlined as a `data:` URI), so the app keeps working under its strict Content-Security-Policy. To change the artwork, replace those files at the same paths and run `npm run build`. The build rejects SVGs containing scripts, event handlers or external links. `plankton-logo.svg` (mark + wordmark) is used by the README.

## Compatibility with planboard 1.x

PLANkton was called planboard up to 1.4. Keep these working:

- Files saved by planboard 1.x open and save (`test/fixtures/planboard-1.4-saved.html`, `test/v15.test.js`). The payload's `app` field (`planboard` or `plankton`) is informational and never checked.
- On first load, `migrateLegacyStorage` copies `planboard:*` localStorage keys (plans, index, prefs such as theme and author name) to `plankton:*` while no `plankton:index` exists; old keys are kept.
- Save file handles: the `plankton` IndexedDB database falls back to the `planboard` one per key (`withLegacyKV`), copying what it finds; the old database is opened only if it already exists.

## Bundler limits

Modules may only use `import { a, b as c } from './x.js'` and `export function|const|let|class`. The build fails on any other syntax, and on an import of a name that the target module does not export.

## Rules of thumb

- No network requests and no new runtime dependencies. The CSP (`connect-src 'none'`) blocks requests anyway.
- Anything read from a file is untrusted: normalise it, cap sizes and counts.
- Pure logic goes in modules that can be tested with `node --test`; tests that touch the description sanitizer import `test/minidom.js` first.
