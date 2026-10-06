# planboard

Single-file HTML project planner: nested tasks, sections, task cards, Gantt with FS/SS/FF/SF dependencies. Opens in any browser, no install.

**Use it:** download [`dist/planboard.html`](dist/planboard.html) and double-click it. It works offline, needs no server and makes no network requests (a strict Content-Security-Policy blocks them). The first open shows a sample plan.

## Features

- **Task tree:** unlimited nesting, Tab / Shift+Tab to indent and outdent, collapse and expand, drag to reorder or re-parent, automatic outline numbers (1, 1.2, 1.2.3). Summary tasks roll up dates and duration-weighted progress.
- **Sections:** coloured header rows that tint the rows and bars beneath them.
- **Task card:** markdown description, start / finish / working-day duration (edit any two and the third is recomputed), status, priority, owner, workstream, tags, milestone, notes, predecessors, custom fields and timestamps.
- **Gantt:** day / week / month / quarter zoom, fit project, today line, weekend shading. Bars can be dragged and resized, and dependencies of all four types take lag or lead (`4FS+2d`, `7SS-1d`).
- **Scheduling:** auto-schedule or conflict highlighting, cycle refusal, critical path, baseline with variance.
- **Views:** Board (kanban by status) and Logs (risks, decisions, open questions).
- **Data:** autosave per plan in `localStorage`, multiple plans, JSON import/export (picker or drag and drop), paste import from Excel / Planner / Smartsheet, CSV export, and a standalone copy that opens read-only in presenter mode.
- **Presenting and output:** presenter mode, landscape print layout, Gantt PNG export.
- **Quality of life:** undo / redo with 200 steps, search and filters, column show/hide and resize, light and dark themes. Press `?` in the app to see the keyboard shortcuts.

## Development

Requires Node 18 or later. There are no dependencies to install.

```sh
npm test          # node --test: scheduling, tree, links, paste import, JSON, markdown
npm run build     # node build.mjs -> dist/planboard.html
npm run check     # fails if dist/planboard.html is stale
```

`dist/planboard.html` is committed. CI runs the tests, rebuilds, and fails if `dist/` differs from the committed copy, so rebuild and commit it with every source change.

### Layout

| Path | What |
| --- | --- |
| `src/schedule/` | Pure scheduling (no DOM): working-day calendar, link types and lag, auto-schedule, conflicts, cycles, roll-up, critical path |
| `src/model/` | Plan schema and normalisation, flat-row tree operations, edit helpers, stats, sample plan |
| `src/io/` | Storage, paste (TSV/CSV) import, CSV export, standalone embedding |
| `src/util/` | HTML escaping, safe markdown subset |
| `src/ui/` | App shell, `grid/`, `gantt/`, `card/`, `board/`, `logs/`, `dialogs/`, print |
| `src/styles/` | CSS, concatenated in file-name order |
| `build.mjs` | Zero-dependency bundler: resolves the relative named ES imports from `src/main.js` and inlines JS and CSS into `src/index.html` |

**Dates:** stored as ISO `YYYY-MM-DD` and handled internally as integer UTC day numbers. `new Date('YYYY-MM-DD')` is never used, so there is no timezone drift. Working days are Monday to Friday, and lag is counted in working days.

**Bundler limits:** modules may only use `import { a, b as c } from './x.js'` and `export function|const|let|class`. The build fails on any other syntax, and on an import of a name that the target module does not export.
