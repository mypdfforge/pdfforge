# Requirements: PDFForge Client-Side Document Processing

**Defined:** 2026-11-07
**Core Value:** Private, zero-server-upload document processing running 100% within the browser.

## v1 Requirements: High-Fidelity Client-Side PDF to Word

Requirements for transforming the client-side `pdfToWord` converter from raw line dumps into structured, formatted `.docx` documents matching the 25-page QA stress benchmark.

### 1. Table Detection & Reconstruction

- [x] **TABLE-01**: Detect tabular bounding boxes and grid coordinates from aligned text runs and bounding rects in the browser.
- [x] **TABLE-02**: Emit native `docx.Table` elements with cell padding, borders, and column width budgets (supporting up to 8-column wide grids).
- [x] **TABLE-03**: Handle merged header rows and multi-currency alignment (negative values in parentheses, currency symbols).

### 2. Typography & Run Formatting

- [x] **TYPO-01**: Extract font weights (bold), font slant (italic), strikethrough, and underlines into discrete `TextRun` properties.
- [x] **TYPO-02**: Detect superscript ($E=mc^2$) and subscript ($H_2SO_4$) based on vertical offsets and scaled font metrics.
- [x] **TYPO-03**: Retain inline hex color codes and background highlights across spans.
- [x] **TYPO-04**: Classify headings vs. body paragraphs dynamically using document-wide font size distributions.

### 3. Layout Flow & Column Splitting

- [x] **FLOW-01**: Separate multi-column magazine layouts into discrete sequential column flows instead of interleaving text across gutters.
- [x] **FLOW-02**: Wrap long unbroken URL paths and Base64 cryptographic blocks cleanly without clipping margins.
- [x] **FLOW-03**: Preserve monospace code syntax blocks with indentation and light container shading.

### 4. Hierarchical Lists & Outlines

- [x] **LIST-01**: Recognize bullet symbols (•, ◦, ▪, -, *) and numbered outlines (1.1, 1.2.1.a).
- [x] **LIST-02**: Support up to 7 levels of hanging indent hierarchy without running off document margins.

### 5. Multi-Lingual & Bi-Directional Text

- [x] **BIDI-01**: Correctly order and shape Bi-Directional (RTL) Arabic and Hebrew text runs.
- [x] **BIDI-02**: Support complex Brahmic/Devanagari conjunct ligatures and CJK ideographs without glyph corruption.

### 6. Interactive & Structural Elements

- [x] **STRUCT-01**: Render callout admonition boxes ([NOTE], [WARNING], [CRITICAL]) with accent borders.
- [x] **STRUCT-02**: Convert form fields, survey checkboxes (`[ ]`), and signature approval blocks into clean layout rows.

## Traceability Matrix

| Requirement | Phase | Status |
| :--- | :--- | :--- |
| FLOW-01, FLOW-02, TYPO-04 | Phase 1: Text Layout & Column Segmentation | Complete |
| TYPO-01, TYPO-02, TYPO-03, LIST-01, LIST-02 | Phase 2: Rich Typography & List Hierarchies | Complete |
| TABLE-01, TABLE-02, TABLE-03 | Phase 3: In-Browser Table Reconstruction | Complete |
| BIDI-01, BIDI-02, STRUCT-01, STRUCT-02, FLOW-03 | Phase 4: Bi-Directional Unicode & Structural Elements | Complete |

**Coverage:**
- v1 requirements: 14 total
- Mapped to phases: 14 (100% coverage)
- Unmapped: 0

---
*Requirements defined: 2026-11-07*
