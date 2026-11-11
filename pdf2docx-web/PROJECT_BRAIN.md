# PROJECT_BRAIN.md — Client-side PDF → DOCX Engine ("pdf2docx-web")

> Read this file first, every session. Then read `PROGRESS.md`. Do NOT re-scan the whole repo unless told to.
> Labels used: **FACT** (verified/decided), **ASSUMPTION** (verify when cheap), **TARGET** (goal number, tune from data).

---

## 0. KICKOFF PROMPT (paste this into Antigravity as the first message)

```
You are the lead engineer building "pdf2docx-web": an enterprise-grade, 100% client-side
PDF→DOCX converter (browser, WebAssembly/Web Workers, zero uploads).

1. Read PROJECT_BRAIN.md fully. It is the single source of truth (architecture, AST, algorithms,
   milestones, loop, gates). If PROGRESS.md exists, read it and resume. If not, create it from §14.
2. Work in PLANNING mode. Before coding each milestone, write an implementation plan artifact
   (tasks, files touched, tests, exit gate). Then execute using the BUILD LOOP in §10.
3. Work ONE milestone at a time (M1..M7). Never start Mn+1 until Mn's EXIT GATE (§9) passes
   on the benchmark (§11) and is recorded in PROGRESS.md.
4. Every change is measured: run `npm run bench`, compare with metrics/baseline.json,
   reject regressions, commit gains. No per-file hacks. Fix root causes in general code.
5. Keep the 4 layers decoupled (Ingest / DLA / AST / Emit). DLA and Emit must be pure
   functions over JSON, runnable in Node and in a Web Worker.
6. After each milestone: update PROGRESS.md, write a compact summary (decisions, done, pending,
   technical notes), commit, and tell me to start a fresh session for the next milestone.
7. If blocked (5 loop iterations with no metric gain, or a missing resource like gold files),
   write BLOCKERS.md with what you tried and what you need, then stop and ask me.
Start now with M1.
```

---

## 1. MISSION (FACT)

Convert complex PDFs (financial reports, contracts, academic papers, forms) into **natively editable** `.docx` matching Adobe Acrobat / Smallpdf quality.

Non-negotiables:
1. **Zero server uploads.** All work in browser: pdf.js (WASM-free JS core), Web Workers, optional ONNX Runtime Web (WebGPU/WASM).
2. **Accuracy over size.** Heavy assets allowed (Brotli delivery).
3. **True Word reflow.** Real paragraphs, headings (outline levels), real lists (numbering.xml), real tables (`w:tbl`). **No floating text boxes for text. Ever.**
4. **100% glyph fidelity.** Use digital Unicode text. No OCR on digital text.
5. **Strict OpenXML.** Opens clean in Word Desktop/Online, Google Docs, LibreOffice. No repair prompt.
6. **UI never freezes.** All heavy work in Workers. Memory-safe for 100+ pages.

Out of scope (v1): scanned/image-only PDFs (OCR), password-protected PDFs without password, PDF forms as live form fields, RTL/vertical scripts (design must not block them later).

---

## 2. TECH STACK (FACT unless noted)

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | |
| Build/dev | Vite | |
| PDF parse | `pdfjs-dist` (Apache-2.0) | Use legacy build for Node bench. MuPDF.js rejected: AGPL. |
| Workers | Web Worker + `comlink` | 1 worker per conversion; optional pool for pages |
| DOCX emit | `docx` npm lib + own post-fix pass via `fflate`/`jszip` | Own XML patch only where lib lacks (e.g. `w:tblHeader`, odd borders) |
| Images | `OffscreenCanvas` (browser), `@napi-rs/canvas` (Node bench) | encode PNG |
| ML (M6, optional) | `onnxruntime-web` (WebGPU → WASM fallback) | layout model; ASSUMPTION: DocLayout-YOLO / PP-DocLayout class model converted to ONNX; verify license before bundling |
| Tests | `vitest` unit, `playwright` e2e/visual | |
| Doc validation | `xmllint`, python-docx load, LibreOffice headless render, (CI) Open XML SDK validator via dotnet | |
| Eval | own TS tools in `tools/` | see §11 |
| Tuning | `tools/autotune.ts` (coordinate-descent over `params.ts`) | |

Design rule: **only `src/ingest/` imports pdf.js.** Everything after ingest consumes/produces plain JSON (`PageIR`, `Doc AST`). This makes DLA iteration fast: ingest once → cache `PageIR` JSON in `corpus/.cache/` → iterate DLA/emit headlessly in Node.

---

## 3. REPO STRUCTURE

```
pdf2docx-web/
  PROJECT_BRAIN.md          # this file (static brain)
  PROGRESS.md               # dynamic status (see §14)
  BLOCKERS.md               # only when blocked
  package.json  tsconfig.json  vite.config.ts  vitest.config.ts
  src/
    core/        ast.ts  pageir.ts  params.ts  geometry.ts  units.ts  log.ts  errors.ts
    ingest/      pdfLoader.ts  opInterpreter.ts  textExtractor.ts  pathExtractor.ts
                 imageExtractor.ts  linkExtractor.ts  fontMap.ts  outlineExtractor.ts
    dla/         glyphs.ts  lines.ts  xycut.ts  readingOrder.ts  headerFooter.ts
                 paragraphs.ts  hyphen.ts  lists.ts  headings.ts  alignment.ts
                 tablesRuled.ts  tablesBorderless.ts  tableMerge.ts  shapes.ts
                 footnotes.ts  codeBlocks.ts  classify.ts  pipeline.ts
                 model/  (onnxLayout.ts, preprocess.ts, postprocess.ts — M6)
    ast/         build.ts  normalize.ts  validate.ts
    emit/        docxEmitter.ts  styles.ts  numbering.ts  tables.ts  sections.ts
                 images.ts  headerFooter.ts  xmlSafe.ts  postfix.ts
    worker/      engine.worker.ts  protocol.ts  progress.ts
    ui/          App.tsx  DropZone.tsx  ProgressBar.tsx  DebugOverlay.tsx
  tests/         unit/  golden/  e2e/
  corpus/        manifest.json  tierA/ ... tierG/  gold/  .cache/
  tools/         bench.ts  compare-text.ts  teds.ts  readingOrder.ts  docx-validate.ts
                 lo-render.sh  visual-diff.ts  autotune.ts  report.ts  ingest-cache.ts
  metrics/       baseline.json  history.jsonl  reports/
```

---

## 4. DATA MODEL

### 4.1 Units (FACT)
- PDF space: points (pt), origin bottom-left. **Normalize in ingest to top-left origin, y down, pt.** Apply page rotation + CropBox at ingest.
- Word: twips = pt × 20; font half-points = pt × 2; EMU = pt × 12700.

### 4.2 PageIR (output of Ingest; JSON-serializable)
```ts
type Rect = { x0:number; y0:number; x1:number; y1:number };
type Glyph = {                 // one per char (or ligature expanded)
  ch: string;                  // Unicode text of this glyph (may be multi-char for ligatures after expansion)
  box: Rect;                   // glyph advance box in page space
  baseline: number;            // y of baseline
  size: number;                // font size pt (effective, after matrix)
  fontKey: string;             // index into fonts[]
  color: string;               // "#RRGGBB"
  rot: 0|90|180|270;           // text direction
  flags: number;               // bit0: PUA/unmapped, bit1: synthetic space, bit2: invisible text (render mode 3)
};
type FontInfo = { key:string; pdfName:string; family:string; bold:boolean; italic:boolean;
                  mono:boolean; serif:boolean; symbolic:boolean };
type Stroke = { kind:'line'|'rect'|'path'; pts:number[]; width:number; color:string; dash?:number[] };
type Fill   = { box:Rect; color:string; alpha:number; z:number; pathPts?:number[] };
type ImageObj = { id:string; box:Rect; pixelW:number; pixelH:number; mime:'image/png'|'image/jpeg';
                  dataRef:string /* key into binary store, NOT inline */; z:number; mask?:boolean };
type LinkObj = { box:Rect; url?:string; destPage?:number };
type PageIR = { pageIndex:number; width:number; height:number; rotation:number;
                glyphs:Glyph[]; fonts:FontInfo[]; strokes:Stroke[]; fills:Fill[];
                images:ImageObj[]; links:LinkObj[]; stats:{ glyphCount:number; puaCount:number } };
```
Binary data (image bytes) lives in a separate store (`Map<string,Uint8Array>`) so JSON stays small; worker transfers buffers, never copies.

### 4.3 Document AST (output of DLA; input of Emit)
```ts
type Run = { text:string; bold?:boolean; italic?:boolean; underline?:boolean; strike?:boolean;
             size?:number; color?:string; font?:string; sup?:boolean; sub?:boolean;
             link?:{url?:string; anchor?:string}; highlight?:string };
type Para = { type:'p'; runs:Run[]; align:'left'|'center'|'right'|'justify';
              indent?:{left:number;first:number;right:number}; spaceBefore?:number; spaceAfter?:number;
              lineSpacing?:number; heading?:1|2|3|4; list?:{id:string;level:number;kind:'bullet'|'number';fmt?:string};
              shading?:string; borders?:Borders; keepNext?:boolean; src:{page:number;box:Rect} };
type Cell = { blocks:Block[]; colSpan:number; rowSpan:number; vMergeContinue?:boolean;
              fill?:string; borders?:Borders; vAlign?:'top'|'center'|'bottom'; width:number };
type Table = { type:'tbl'; colWidths:number[]; rows:{cells:Cell[]; height?:number; header?:boolean}[];
              borders?:Borders; src:{page:number;box:Rect} };
type ImageBlock = { type:'img'; ref:string; w:number; h:number; inline:boolean; anchor?:AnchorSpec };
type Block = Para | Table | ImageBlock | { type:'pagebreak' } | { type:'sectionBreak'; sect:SectionProps };
type Section = { page:{w:number;h:number;orient:'portrait'|'landscape'}; margins:{t:number;r:number;b:number;l:number};
                 cols?:{count:number;gap:number}; header?:Block[]; footer?:Block[]; blocks:Block[] };
type DocAST = { sections:Section[]; numbering:NumberingDef[]; styles:StyleDef[]; meta:{pages:number; warnings:Warning[]} };
```

---

## 5. PIPELINE (ALL STAGES, WITH ALGORITHMS)

Stage order per document: **S1 Ingest → S2 Glyph→Line → S3 Region/Reading order → S4 Furniture (header/footer) → S5 Tables → S6 Paragraphs → S7 Lists & Headings → S8 Shapes/Images → S9 AST build + validate → S10 Emit → S11 Post-fix + validate.**

---

## 6. WORKER, CONCURRENCY & MEMORY (FACT)

- `engine.worker.ts` exposes via Comlink: `convert(file: ArrayBuffer, opts) → {docx: Blob, report}` + `onProgress(stage, page, total)`.
- Page-streamed: for page p: ingest → S2 → cache minimal per-page IR → free pdf.js page.
- Cancellation: `AbortSignal` checked between pages/stages.

---

## 8. PARAMS & AUTOTUNE
- All numeric thresholds in `src/core/params.ts`.

---

## 9. MILESTONES (7)
- **M0**: Scaffold & Bench harness.
- **M1**: Ingestion + AST + Emitter (single-column MVP).
- **M2**: Paragraphs, Lists, Furniture, Headings.
- **M3**: Multi-column Reading Order.
- **M4**: Bordered Tables.
- **M5**: Borderless / Financial Tables.
- **M6**: Shapes, Visual Parity, Footnotes, ML Layout.
- **M7**: Benchmark vs Giants, Hardening, Release.
