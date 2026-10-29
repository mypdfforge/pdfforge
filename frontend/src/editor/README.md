# Client-side PDF editor (Resume Editor tool)

Opens, edits and exports PDFs **entirely in the browser**. No upload, no server CPU, no new backend.
Route/registry: `editor` tool (`pages/EditorPage.jsx`, `utils/tools.js` now `runs:'browser'`).

## Before / after (audit)
| | Before | After |
|---|---|---|
| Open/parse | `POST /api/upload` (PyMuPDF) | pdf.js + own content-stream analyser, in browser |
| Preview | `POST /api/export/{id}/preview-edited` | pdf.js render of the export engine's own output |
| Export | `POST /api/export/{id}` (white rectangle + black Noto text) | pdf-lib in a Web Worker, non-destructive |
| Dead code | `components/PDFEditor.jsx` (unused) | untouched |
Legacy `backend/routes/{upload,export}.py`, `utils/api.js` and `SectionCard.jsx` are no longer referenced by the editor and were left in place (not deleted).

## How editing works
1. `core/extract.ts` merges pdf.js text items with `core/contentStream.ts` (tokenizer + text-state analyser: origin, colour, font, spacing per show-instruction; fonts via pdf-lib) into a document model (`core/types.ts`). PDF points, bottom-left origin; zoom only converts to CSS (`core/geometry.ts`).
2. Every edit is an immutable operation in `core/store.ts` (undo/redo, Format Painter, global styles, find/replace, mode switch).
3. `core/plan.ts` / `core/reflow.ts` compile the model into a **Plan** (instructions to remove/translate + text to draw). Preview and export both run `PdfEngine.build(plan)` so they cannot disagree.
4. `core/engine.ts` (worker via `worker/exportWorker.ts`, or in-thread fallback) rewrites only the targeted drawing instructions (everything else byte-identical), draws new text with the original colour/size/position in the mapped standard font, appends pages when needed.
5. `core/validate.ts` reopens the result with pdf.js: page count, edited text present, old text gone. A failed check blocks the automatic download.
Autosave/versions: IndexedDB (`core/projects.ts`), this browser only.

## Modes
* **Design Lock**: original positions kept. Overflow (against the text region's real boundary, not the page edge) and collisions are flagged; fix by Wrap / Shrink to fit / Reflow. Export asks before shipping known overflow.
* **Document Reflow**: after an explicit reconstruction (paragraph/heading/bullet blocks, editable roles, merge, keep-fixed). Unedited blocks keep their original font (moved with a `Td` pair); edited blocks are re-wrapped with exact metrics; same-row items (e.g. dates) travel with their line; pagination with widow/orphan control, headings kept with next, new pages appended.

## Known limitations (deliberate, surfaced in the UI where possible)
* **New text uses Helvetica/Times/Courier (WinAnsi)**; original fonts cannot be re-embedded. Unedited text keeps its original font. Characters outside WinAnsi are flagged and print as `?`. No kerning/ligatures/variable fonts in export (plain `Tj`; measurement is un-kerned to match). Next step: `@pdf-lib/fontkit` + bundled Unicode font, or reusing glyphs of embedded subsets.
* Text inside Form XObjects/patterns, rotated text, rotated pages, invisible OCR layers, and text sharing one drawing instruction with neighbours are **locked** (explicit "Cover & replace" only for the first kind).
* Rows are modelled as one left flow line + followers; true multi-column flow, tables, images and vector graphics are not tracked as obstacles in Reflow (warning shown on pages with graphics).
* Colour: DeviceGray/RGB/CMYK and N-component spaces by operand count; patterns/shadings fall back to black.
* Limits: 50 MB, 200 pages (`core/limits.ts`). Encrypted PDFs are rejected with a clear message.
* No OCR, no accounts/cloud sync (intentionally absent: optional future capabilities, not prerequisites).

## Tests
`npm run fixtures` (reportlab + pikepdf, dev only) → `npm test` (node:test, 22 tests) → `npm run typecheck` → `npm run test:e2e` (esbuild + Playwright/Chromium; needs those tools installed globally, see `e2e/build.mjs`). Not run in CI here: `vite build`.

## Checklist / next
- [x] local open → edit → export → verify · [x] style preservation · [x] Design Lock · [x] Reflow + pagination · [x] undo/redo, painter, global styles · [x] autosave/versions · [x] worker + fallback · [x] network audit
- [ ] Run `vite build` + test with the production pdf.js 3.11.174 and React 18 (tests used pdf.js 5.6 / React 19)
- [ ] Unicode export fonts · [ ] reuse embedded subset glyphs · [ ] splitting blocks in the reconstruct panel · [ ] image/graphics obstacles in reflow · [ ] optional cloud save (existing auth) · [ ] a11y audit with a screen reader
