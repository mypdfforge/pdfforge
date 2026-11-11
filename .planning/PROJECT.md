# PDFForge: Client-Side High-Fidelity PDF & Document Converter

## What This Is

PDFForge is a 100% client-side, browser-based document processing suite with zero server dependency for core operations. It gives users immediate, private PDF editing, conversion, splitting, merging, and formatting directly inside the browser using modern WebAssembly, pdf-lib, pdfjs-dist, and client-side OOXML generators.

## Core Value

Private, zero-server-upload document processing that runs entirely within the user's browser, delivering high-fidelity conversions without sending confidential files to external servers.

## Business & Privacy Context

- **User Model**: Privacy-conscious individuals, enterprises, and legal/financial teams handling confidential documents that cannot leave client devices.
- **Privacy Guarantee**: 100% client-side execution; all conversions, text rendering, and document assembly run within browser memory.
- **Success Metric**: High-fidelity round-trip conversion matching complex multi-column, table, RTL, and typographic layouts (tested against the 25-page stress benchmark suite).

## Requirements

### Validated

- ✓ Client-side PDF page organization (split, merge, rotate, delete) — existing
- ✓ Client-side Word-to-PDF compilation via Rust WASM (`docx2pdf_bg.wasm`) — existing
- ✓ Universal High-Accuracy WASM Conversion Engine (Milestone 2 completed 2026-11-11)
- ✓ Commercial-grade Word (`.docx`) conversion matching Smallpdf parity across 25 stress chapters
- ✓ Multi-sheet formula-ready Excel (`.xlsx`) emitter with typed numerical cells and accounting formats
- ✓ Native, 100% editable 2D PowerPoint (`.pptx`) slide emitter replacing raster snapshots
- ✓ Format-agnostic Universal Document AST (`documentAst.js`) and Layout Analysis engine (`documentLayoutAnalysis.js`)
- ✓ Background async Web Worker chunking pipeline for responsive main UI

### Active (Milestone 3 / Next Cycle)

- Planned next milestone: Mobile touch responsiveness & advanced cloud-free PDF/A-4 validator

### Out of Scope

- Cloud-side storage of user files — Violates client-side zero-retention privacy model.
- Mandatory server-side conversion backends for standard workflows — All core tools must function in the browser.

## Context

- The user provided the 25-page stress test document `test_25pages_output.pdf` (`PDFForge QA Test Suite • Confidential & Automated Test Benchmark`).
- The baseline PDF-to-Word tool (`frontend/src/utils/convertClient.js`) currently exports text line-by-line as raw paragraphs.
- Upgrading the client-side pipeline will turn raw coordinate streams into semantic Word document structures (tables, headings, columns, formatted runs).

## Constraints

- **Execution Environment**: Client-side browser execution (V8 / SpiderMonkey / JavaScriptCore WebAssembly & Web Workers).
- **Memory Ceiling**: Must avoid browser tab crashes on multi-page dense documents (e.g., using streaming parsers and progressive canvas downsampling).
- **Bundle Size**: Client-side libraries must remain lightweight and fast loading.

## Key Decisions

| Decision | Rationale | Outcome |
| :--- | :--- | :--- |
| **Strict Client-Side Priority** | Absolute document confidentiality and zero server hosting overhead | ✓ Good |
| **Direct OOXML `.docx` Generation** | Using client `docx` / WASM library to write native Word OpenXML packages | ✓ Good |
| **25-Page Stress Matrix Benchmark** | Serves as the ground truth acceptance test suite for layout and typography | ✓ Good |

---
*Last updated: 2026-11-07 after project initialization*
