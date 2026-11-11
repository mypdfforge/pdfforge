# Roadmap: PDFForge Client-Side High-Fidelity Converter

## Overview

Transform the client-side `pdfToWord` engine into a high-fidelity document reconstruction pipeline running 100% in the user's browser, verified against the 25-page multi-format stress benchmark (`test_25pages_output.pdf`).

## Phases

- [x] **Phase 1: Text Layout & Column Segmentation** - Accurate spatial reading order, multi-column flow separation, and heading detection.
- [x] **Phase 2: Rich Typography & List Hierarchies** - Font weight, italic, color, super/subscript, and 7-level nested list outlines.
- [x] **Phase 3: In-Browser Table Reconstruction** - Grid detection, cell clustering, borders, and merged-header Word tables.
- [x] **Phase 4: Bi-Directional Unicode & Structural Elements** - RTL Arabic/Hebrew shaping, Devanagari ligatures, admonition callouts, and form fields.
- [x] **Phase 5: High-Fidelity Smallpdf Parity & Reflow Engine** - Paragraph soft-line reflow, authentic table palettes, and exact Smallpdf structural parity.
- [x] **Phase 6: Core WASM Vector & Layout Extractor** - Raw graphics OperatorList parser, vector stroke/fill extraction, and geometric cell solver.
- [x] **Phase 7: Universal Intermediate AST & Multi-Format DLA** - Unified document tree for Word, Excel, and PowerPoint.
- [x] **Phase 8: High-Accuracy DOCX & Multi-Sheet XLSX Emitters** - Word commercial reflow and Excel multi-table accounting emitter.
- [x] **Phase 9: PPTX Emitter & Web Worker Pipeline** - PowerPoint 2D slide vector layout and background worker processing.

---

## Phase Details

### Phase 9: PPTX Emitter & Web Worker Pipeline
**Goal**: Build an editable 2D PowerPoint slide emitter and background Web Worker pipeline consuming the Universal Document AST.
**Depends on**: Phase 8
**Requirements**: EMIT-PPTX-01, WORKER-01, EDITABLE-SLIDE-01
**Success Criteria**:
1. PPTX Emitter renders editable native slide text frames, slide tables, and vector shapes from AST nodes.
2. Background Web Worker chunking pipeline enables non-blocking multi-page conversions with progress reporting.
3. Automated test suite and production build pass with 100% test coverage.
**Plans**: 1 plan

Plans:
- [x] 09-01: Editable PPTX Slide Emitter & Background Web Worker Pipeline

### Phase 8: High-Accuracy DOCX & Multi-Sheet XLSX Emitters
**Goal**: Build format-specific emitters for Word and Excel consuming the Universal Document AST with typed numbers and vector formatting.
**Depends on**: Phase 7
**Requirements**: EMIT-DOCX-01, EMIT-XLSX-01, ACCOUNTING-01
**Success Criteria**:
1. DOCX Emitter maps AST nodes into valid OpenXML paragraphs, multi-span runs, and vector-shaded tables.
2. XLSX Emitter extracts all AST tables into multi-sheet workbooks with typed numerical values (`typeof cell.value === 'number'`) and accounting formats.
3. Client-side browser conversion runs cleanly with 100% test coverage.
**Plans**: 1 plan

Plans:
- [x] 08-01: High-Accuracy DOCX & Multi-Sheet XLSX Emitters

### Phase 7: Universal Intermediate AST & Multi-Format DLA
**Goal**: Decouple raw PDF layout extraction from output formats by introducing a unified Document AST and DLA engine for Word, Excel, and PowerPoint.
**Depends on**: Phase 6
**Requirements**: AST-01, DLA-01, TABLE-04, MULTI-01
**Success Criteria**:
1. Strongly typed JSON-serializable AST nodes representing pages, paragraphs, runs, tables, callouts, and vector shapes.
2. Table cells extract numeric metadata (currencies, parenthetical accounting negatives, percentages) for spreadsheet fidelity.
3. Visitor traversal and table extractors empower independent output target emitters.
**Plans**: 1 plan

Plans:
- [x] 07-01: Universal Intermediate AST & Multi-Format DLA

### Phase 6: Core WASM Vector & Layout Extractor
**Goal**: Build the vector geometry extraction layer to capture raw PDF strokes, line grids, clipping paths, and background fills with sub-pixel coordinate precision.
**Depends on**: Phase 5
**Requirements**: WASM-01, VECTOR-01, DLA-01
**Success Criteria**:
1. Raw vector lines ($H$ and $V$) and fill rectangles are extracted directly from PDF binary/graphics operations.
2. Table cell boundaries are mathematically verified by vector intersections rather than heuristic spacing.
3. Authentic background fill colors are extracted directly from vector path fills.
**Plans**: 1 plan

Plans:
- [x] 06-01: Build PDF Vector Geometry & OperatorList WASM Extractor

### Phase 5: High-Fidelity Smallpdf Parity & Reflow Engine
**Goal**: Elevate the client-side conversion engine to match Smallpdf's exact document reconstruction accuracy, continuous flowing paragraphs, and authentic theme palettes across all 25 chapters.
**Depends on**: Phase 4
**Requirements**: FLOW-01, FLOW-02, TABLE-01, TABLE-02, TYPO-01, STRUCT-01
**Success Criteria**:
1. Multi-line titles, descriptions, and legal clauses merge into single flowing paragraphs.
2. Real data tables match the authentic 15 tables with source PDF header palette fills.
3. Section 13 code block is 100% unified without orphaned lines.
4. Callouts render as clean native paragraphs with accent borders and tints.
**Plans**: 1 plan

Plans:
- [x] 05-01: Implement paragraph reflow unwrapping, authentic table palettes, and Smallpdf structural parity

### Phase 1: Text Layout & Column Segmentation
**Goal**: Segment page text items into logical paragraphs and respect multi-column gutters so that text flows naturally down columns rather than cutting horizontally across the page.
**Depends on**: Nothing
**Requirements**: FLOW-01, FLOW-02, TYPO-04
**Success Criteria** (what must be TRUE):
1. 2-column layouts (Section 3 of stress test) read sequentially column 1 then column 2 without interleaving text.
2. Long URLs and unbroken strings wrap gracefully without clipping.
3. Major titles and section headers are tagged with appropriate heading styles based on font size analysis.
**Plans**: 2 plans

Plans:
- [x] 01-01: Build PDF Layout Segmenter with column gutter detection and URL margin wrap sanitizer
- [x] 01-02: Integrate dynamic heading classification and reading-order flow into client-side pdfToWord

### Phase 2: Rich Typography & List Hierarchies
**Goal**: Preserve run-level typographic attributes and hierarchical outlines within native Word OpenXML paragraphs.
**Depends on**: Phase 1
**Requirements**: TYPO-01, TYPO-02, TYPO-03, LIST-01, LIST-02
**Success Criteria**:
1. Bold, italic, underline, strikethrough, and color runs are preserved in `.docx`.
2. Math and chemical formulas ($H_2SO_4$, $E=mc^2$) emit proper superscript/subscript runs.
3. Nested outlines (up to 7 levels) maintain correct indentation and bullet markers.
**Plans**: 2 plans

Plans:
- [x] 02-01: Enhance pdfLayoutSegmenter with span-level styling, colors, and super/subscript detection
- [x] 02-02: Integrate multi-span TextRuns and 7-level list outline indentation into convertClient

### Phase 3: In-Browser Table Reconstruction
**Goal**: Automatically identify tabular grids, align numeric columns, and generate real `docx.Table` elements with cell borders and merged spans.
**Depends on**: Phase 2
**Requirements**: TABLE-01, TABLE-02, TABLE-03
**Success Criteria**:
1. Cluster matrix and balance sheet pages (Sections 4, 5, 10) render as real editable Word tables.
2. Merged headers and multi-currency formats with parentheses remain aligned.
3. Dense security audit logs and multi-row matrices preserve column boundaries.
**Plans**: 2 plans

Plans:
- [x] 03-01: Build pdfTableDetector with column coordinate clustering and merged header detection
- [x] 03-02: Integrate native docx Table generation with cell borders and header shading

### Phase 4: Bi-Directional Unicode & Structural Elements
**Goal**: Support RTL languages, complex non-Latin scripts, code blocks, and visual callout admonitions.
**Depends on**: Phase 3
**Requirements**: BIDI-01, BIDI-02, STRUCT-01, STRUCT-02
**Success Criteria**:
1. Arabic and Hebrew lines render in correct right-to-left visual order.
2. Devanagari and CJK characters maintain font rendering and spacing integrity.
3. Admonition callouts and interactive form checkboxes appear cleanly formatted.
**Plans**: 2 plans

Plans:
- [x] 04-01: Bi-Directional Text & Multi-Lingual Font Shaping (Arabic, Hebrew, Devanagari, CJK)
- [x] 04-02: Structural Callouts, Monospace Code Blocks & Interactive Form Elements

---

## Progress

| Phase | Plans Complete | Status | Completed |
| :--- | :--- | :--- | :--- |
| Phase 1: Text Layout & Column Segmentation | 2/2 | Complete | 2026-11-07 |
| Phase 2: Rich Typography & List Hierarchies | 2/2 | Complete | 2026-11-07 |
| Phase 3: In-Browser Table Reconstruction | 2/2 | Complete | 2026-11-07 |
| Phase 4: Bi-Directional Unicode & Structural Elements | 2/2 | Complete | 2026-11-07 |

---
*Roadmap defined: 2026-11-07*
