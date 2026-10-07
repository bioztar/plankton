# planboard

Single-file HTML project planner: nested tasks, sections, task cards, Gantt with FS/SS/FF/SF dependencies. Opens in any browser, no install.

**Use it:** download [`dist/planboard.html`](dist/planboard.html) and double-click it. It works offline, needs no server and makes no network requests (a strict Content-Security-Policy blocks them). The first open shows a sample plan.

## Features

- **Task tree:** unlimited nesting, Tab / Shift+Tab to indent and outdent, collapse and expand, drag to reorder or re-parent, automatic outline numbers (1, 1.2, 1.2.3). Summary tasks roll up dates and duration-weighted progress.
- **Sections:** coloured header rows that tint the rows and bars beneath them.
- **Editing:** single click selects, double-click / F2 / typing edits a cell; hover a row and click **↗** (or press Enter on the name, use the toolbar **Open details**, right-click → Open details, or click a Gantt bar) to open the task details.
- **Task details:** a large, resizable side panel (maximize for full window; ↑/↓ step through tasks; Esc closes) with the task name, a compact fields strip (dates, working-day duration — edit any two and the third is recomputed — progress, status, priority, owner, workstream, milestone, tags, custom columns), a rich-text **description**, predecessors / successors, notes, per-task custom fields and timestamps.
- **Rich-text descriptions:** WYSIWYG editor (headings, bold/italic/underline/strike, lists, checklists, quotes, code, links, tables, rules). Paste from Word, Outlook, OneNote or web pages keeps the structure; Markdown-looking text is converted. Everything is passed through a strict DOMParser allow-list sanitizer on paste and on load (no scripts, styles, images or event handlers), stored as `descHtml`; CSV exports plain text. Old markdown descriptions are migrated on load.
- **Columns:** right-click a header or use **Columns ▾** to show/hide, move left/right, or drag headers to reorder (task name stays first). Add plan-level **custom columns** (text, number, date, single-select, checkbox, person, URL), rename, edit options, delete (undoable); per-task custom fields can be promoted with “Show as column”. Order, visibility and widths are saved in the plan file; search, CSV export and paste import include custom columns.
- **Gantt:** day / week / month / quarter zoom, fit project, today line, weekend shading. Bars can be dragged and resized, and dependencies of all four types take lag or lead (`4FS+2d`, `7SS-1d`).
- **Scheduling:** auto-schedule or conflict highlighting, cycle refusal, critical path, baseline with variance.
- **Views:** Board (kanban by status) and Logs (risks, decisions, open questions).
- **Save in place:** **Save** (header button or Ctrl/Cmd+S) writes the plan into the .html file itself. In Edge / Chrome / Brave the first Save asks where to save (suggesting the current file name) and later Saves overwrite that file directly; the file handle is remembered per plan and opened file in IndexedDB, so Save keeps working after a reload while the browser still grants access. If the file was changed by someone else since you opened it, Save asks before overwriting. **Save as…** (Shift+Ctrl/Cmd+S) always asks. Safari and Firefox (no File System Access API) download `<plan name>.html` instead: replace the original file with it. The header shows *Unsaved changes* / *Saved to file 14:32*, and closing the tab with unsaved edits asks first.
- **Sharing:** put the .html on OneDrive / Teams / SharePoint; anyone opens it in Edge or Chrome, edits and presses Save. Every saved copy opens editable (including v1 “standalone copies”); **Export read-only presenter copy** is the only way to make a read-only file.
- **Data:** autosave per plan in `localStorage` as a safety net, multiple plans, JSON import/export (picker or drag and drop), paste import from Excel / Planner / Smartsheet, CSV export. Newer edits saved in the browser win when a file is reopened, with a banner to switch back to the file version; Save then writes the version shown.
- **Presenting and output:** presenter mode, landscape print layout, Gantt PNG export.
- **Quality of life:** undo / redo with up to 200 steps (history capped at ~20 MB, unchanged rows shared between steps), search and filters, column show/hide and resize, light and dark themes. Press `?` in the app to see the keyboard shortcuts.

## Development

Requires Node 18 or later. There are no dependencies to install.

```sh
npm test          # node --test: scheduling, tree, links, paste import, JSON, markdown, sanitizer, custom columns
npm run build     # node build.mjs -> dist/planboard.html
npm run check     # fails if dist/planboard.html is stale
```

`dist/planboard.html` is committed. CI runs the tests, rebuilds, and fails if `dist/` differs from the committed copy, so rebuild and commit it with every source change.

### Layout

| Path | What |
| --- | --- |
| `src/schedule/` | Pure scheduling (no DOM): working-day calendar, link types and lag, auto-schedule, conflicts, cycles, roll-up, critical path |
| `src/model/` | Plan schema and normalisation, flat-row tree operations, edit helpers, stats, sample plan |
| `src/io/` | Storage, paste (TSV/CSV) import, CSV export, payload embedding, save-in-place (`filesave.js`: save-state machine, handle registry, conflict check, save flow) |
| `src/util/` | HTML escaping, markdown → HTML, description sanitizer |
| `src/ui/` | App shell, `grid/`, `gantt/`, `card/`, `board/`, `logs/`, `dialogs/`, print |
| `src/styles/` | CSS, concatenated in file-name order |
| `build.mjs` | Zero-dependency bundler: resolves the relative named ES imports from `src/main.js` and inlines JS and CSS into `src/index.html` |

**Dates:** stored as ISO `YYYY-MM-DD` and handled internally as integer UTC day numbers. `new Date('YYYY-MM-DD')` is never used, so there is no timezone drift. Working days are Monday to Friday, and lag is counted in working days.

**Bundler limits:** modules may only use `import { a, b as c } from './x.js'` and `export function|const|let|class`. The build fails on any other syntax, and on an import of a name that the target module does not export.
