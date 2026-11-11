---
phase: 07-universal-intermediate-ast-dla
plan: 01
status: completed
date: 2026-11-11
summary: Constructed Universal Intermediate AST schema and Document Layout Analysis (DLA) engine supporting Word, Excel, and PowerPoint output targets.
---

# Plan 07-01 Summary: Universal Intermediate AST & Multi-Format DLA

## Accomplishments
1. **Universal Intermediate AST (`documentAst.js`):**
   - Standardized format-agnostic document representation using strongly typed node factories: `DOCUMENT`, `PAGE`, `PARAGRAPH`, `TEXT_RUN`, `TABLE`, `TABLE_ROW`, `TABLE_CELL`, `CALLOUT`, `CODE_BLOCK`, and `SHAPE`.
   - Built full tree visitor utilities (`walkAst`), table queries (`extractTablesFromAst`), and JSON serialization (`serializeAst`).
   - Equipped `TableCellNode` with dual representation: human-readable formatted string and typed numerical metadata (`isNumeric`, `rawValue`, `formatCode`) to empower Excel `.xlsx` multi-table extraction.
   - Equipped `PageNode` and `ShapeNode` with 2D coordinates and bounding boxes to empower PowerPoint `.pptx` slide placement.

2. **Multi-Format Document Layout Analysis (`documentLayoutAnalysis.js`):**
   - Implemented `parseNumericCell` capable of handling accounting parenthetical negatives (e.g. `(1,250.00)` -> `-1250.00`), currencies, percentages, and standard numbers.
   - Implemented `buildDocumentAst(pagesData, metadata)` which coordinates spatial line segmenting, table boundary detection with vector geometry, paragraph unwrapping, and AST generation.

3. **Automated Verification:**
   - Created test suite `tests/word-to-pdf/documentAst.test.js` validating AST hierarchy, numeric parsing, mock page layout conversion, and visitor traversal.
   - All 51 tests across 8 suites passed cleanly.

## Key Files Created
- `frontend/src/utils/documentAst.js` (created)
- `frontend/src/utils/documentLayoutAnalysis.js` (created)
- `frontend/tests/word-to-pdf/documentAst.test.js` (created)
- `.planning/phases/07-universal-intermediate-ast-dla/07-01-PLAN.md` (created)
