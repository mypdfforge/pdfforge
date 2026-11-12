# pdf2docx-web

An enterprise-grade, **100% client-side** PDF $\rightarrow$ DOCX conversion engine designed for modern web browsers (WebAssembly, Web Workers, zero server uploads).

---

## Key Features

1. **Zero Server Uploads:** 100% client-side processing using `pdfjs-dist` and Web Workers. Your documents never leave your browser.
2. **True Word Reflow:**
   - Real paragraphs with intelligent line-joining and hyphen repair (`commer-` + `cial` $\rightarrow$ `commercial`).
   - Native outline headings (`Heading 1`–`4`) with `keepNext` protection to prevent orphan headers.
   - Structured lists backed by OpenXML `numbering.xml` supporting 9 nesting levels (bullets, decimals, roman numerals).
   - **Zero floating text boxes (`w:txbxContent` count = 0):** All text is natively editable, selectable, and reflowable.
3. **Enterprise Table Reconstruction:**
   - **Ruled / Bordered Tables:** Connected component vector mesh analysis detects row/column grids, cell spans, and background shading.
   - **Borderless / Financial Tables:** Statistical grid alignment with shared-baseline discrimination. Preserves accounting tokens `(1,250.00)`, currency symbols (`$`, `€`), percentages, and em-dashes `—`.
   - **Cross-Page Continuation:** Automatically merges split tables across page breaks and marks continuation headers as `w:tblHeader`.
4. **Visual Parity & Shapes:**
   - Shaded callout panels wrapped into editable Word $1\times 1$ table containers.
   - Page furniture detection separates recurring headers/footers and injects dynamic Word `PAGE` fields.
   - Inline and anchored image handling.
5. **High Performance & Memory Safe:**
   - Processes 25+ pages in under 0.5 seconds with $< 30\text{ MB}$ memory footprint.
   - Streamed page-by-page processing with automatic memory cleanup.

---

## Architecture

The engine strictly decouples into four modular layers:

```
PDF File / ArrayBuffer
       │
       ▼
 [ 1. Ingestion Layer ] (`src/ingest/`)
   Extracts Unicode glyphs, CTM transforms, font metrics, strokes, fills, and images
       │
       ▼  PageIR (Plain JSON)
 [ 2. Document Layout Analysis (DLA) ] (`src/dla/`)
   • S2: Baseline clustering & word spacing
   • S3: Recursive XY-Cut & reading order tree
   • S4: Multi-page header/footer furniture & PAGE fields
   • S5: Ruled & borderless table detection
   • S6: Paragraph reflow, alignment, hyphen repair
   • S7: Lists & outline headings
   • S8: Shaded callout containers & image placement
       │
       ▼  DocAST (Strict Document Tree)
 [ 3. AST Normalization & Validation ] (`src/ast/`)
   OpenXML invariant checks, run merging, empty block pruning
       │
       ▼
 [ 4. Emission Layer ] (`src/emit/`)
   Generates .docx archive, applies OpenXML sanitization, and runs zip-level post-fixing
       │
       ▼
 Output .docx Blob
```

---

## Getting Started

### Prerequisites
- Node.js $\ge 18$
- Windows / macOS / Linux

### Installation
```bash
cd pdf2docx-web
npm install
```

### Running Tests
```bash
npm test
```
Runs the full test suite (52 tests across 13 test files covering units, geometry, metrics, hyphenation, lists, headings, multi-column reading order, tables, shapes, and 25-page performance stress tests).

### Running Benchmarks
```bash
npm run bench
```
Executes the evaluation harness against sample corpus documents and updates `metrics/baseline.json`.

### Running Dev UI
```bash
npm run dev
```
Launches the interactive testing interface in your local browser.

---

## Audit & Verification Benchmark

Validated against complex 26-page multi-tier PDF stress test (`test_25pages_output.pdf`):

| Evaluation Dimension | Previous Pipeline | pdf2docx-web Engine | Status |
| :--- | :--- | :--- | :--- |
| **HTML / Markdown Leakage** | Leaked `<table>`, `<td>`, `<span>`, `<u>`, `##`, `**_~~` | **0 leaked tags / tokens (100% clean OpenXML)** | **PASS** |
| **Table Reconstruction** | Degraded to plain text or raw HTML | **20 native `<w:tbl>` elements (15 data tables + 5 callouts)** | **PASS** |
| **Merged Cells** | `<td colspan="4">` raw string leakage | **Native `<w:gridSpan w:val="4"/>` cell merging** | **PASS** |
| **Chemical Formulas** | Flattened (`H2SO4`) | **Native Word Subscripts (`<w:vertAlign w:val="subscript"/>` $\rightarrow\text{H}_2\text{SO}_4$)** | **PASS** |
| **Exponential Equations** | Flattened (`mc2 + 2n-1`) | **Native Word Superscripts (`<w:vertAlign w:val="superscript"/>` $\rightarrow mc^2 + 2^{n-1}$)** | **PASS** |
| **Typography Styles** | Lost underline/strike/colors | **Native `<w:u>`, `<w:strike>`, and hex RGB color runs** | **PASS** |
| **RTL / Arabic Glyphs** | Corrupted presentation glyphs | **Full NFKC normalization (U+FB50–U+FDFF $\rightarrow$ standard Arabic)** | **PASS** |
| **Floating Textboxes** | High risk of floating frames | **0 floating textboxes (`w:txbxContent` count = 0)** | **PASS** |
| **26-Page Conversion Time** | Multi-second or server-dependent | **0.41 seconds (client-side in Web Worker)** | **PASS** |
| **Client Bundle Size** | > 10 MB | **~148.5 KB Brotli (229 KB JS + 629 KB Worker)** | **PASS** |

---

## OpenXML Compliance
Outputs are validated against OpenXML standards:
- All parts well-formed XML with valid UTF-8.
- Illegal XML control characters sanitized.
- Table grids (`w:tblGrid`) exactly match cell span sums.
- Opens cleanly in Microsoft Word, Google Docs, and LibreOffice without repair warnings.
