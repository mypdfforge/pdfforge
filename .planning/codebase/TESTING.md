---
last_mapped_commit: b21884f1c66d14e46e24dcca588d6fb591273045
last_mapped_at: 2026-11-07
---
# Testing Patterns

**Analysis Date:** 2026-11-07

## Test Framework

**Runners:**
- **Vitest (2.1.8)**: Modern ESM test runner for frontend feature testing (`frontend/tests/word-to-pdf/`)
- **Node Test Runner (`node --test`)**: Built-in test runner for editor core modules and geometry verification
- **Playwright / Chromium**: End-to-end integration and browser rendering tests (`frontend/e2e/`)
- **Python Custom Runners**: Stress test benchmarks and throughput checks (`backend/test_stress.py`, `backend/test_max_capacity.py`)

**Run Commands:**
```bash
# Frontend Word-to-PDF feature tests
npm --prefix frontend run test:word

# Frontend editor core unit tests
npm --prefix frontend run test

# Frontend typechecking
npm --prefix frontend run typecheck

# Full End-to-End integration tests
npm --prefix frontend run test:e2e

# Generate editor test fixtures
npm --prefix frontend run fixtures

# Backend stress benchmarks
python backend/test_stress.py
python backend/test_max_capacity.py
```

## Test File Organization

**Locations:**
- Feature Tests: `frontend/tests/word-to-pdf/` (e.g. `engineHost.test.js`, `probe.test.js`)
- Editor Unit Tests: `frontend/src/editor/__tests__/` (e.g. geometry, extraction, layout)
- End-to-End Tests: `frontend/e2e/` (e.g. `build.mjs`, `e2e.mjs`)
- Visual Regression / Diff: `docx2pdf/compare_pdfs.mjs`

**Naming:**
- Unit/Integration tests: `*.test.js` or `*.test.ts`
- Benchmark scripts: `test_*.py`

## Test Structure & Patterns

**Vitest Feature Testing Example (`frontend/tests/word-to-pdf/probe.test.js`):**
```javascript
import { describe, it, expect } from 'vitest'
import { probeFileCapabilities } from '../../src/features/word-to-pdf/lib/probe.js'

describe('Word to PDF Capability Probe', () => {
  it('detects complex tables and highlights', async () => {
    const mockFile = new Uint8Array([/* mock OOXML zip */])
    const capabilities = await probeFileCapabilities(mockFile)
    expect(capabilities).toBeDefined()
    expect(capabilities.hasTables).toBe(true)
  })
})
```

**Visual Regression & Diffing Pattern:**
- `docx2pdf/compare_pdfs.mjs` renders reference PDFs (e.g. LibreOffice output vs PDFForge output) to raster images and calculates Structural Similarity (SSIM) or pixel diff metrics.

## QA & Benchmark Matrix

**Stress Benchmark Fixture:**
- `test_25pages_output.pdf`: 25-page multi-format verification document testing:
  1. Multi-column editorial typography
  2. Nested tables with merged column/row spans
  3. Multi-currency accounting balance sheets
  4. Hierarchical outlines & 7-level bullet indentation
  5. Multi-lingual Unicode (Arabic/Hebrew RTL, CJK, Devanagari, Cyrillic, Greek)
  6. Subscripts, superscripts, and chemical formulas ($H_2SO_4$, $E=mc^2$)
  7. Wide 8-column data matrices and unbroken URL boundary wrapping
  8. Code blocks with monospace indentation
  9. Footnotes, citations, and legal contract clauses
  10. Interactive form elements (checkboxes, radio buttons, signature blocks)

## Coverage & Quality Goals

- Core conversion paths (PDF to Word, Word to PDF, PDF to Excel) must maintain structural fidelity without silently omitting tables, images, or RTL text runs.
- File system operations must be tested with adversarial filenames containing path traversal tokens (`../`) to guarantee containment within temporary directories.

---

*Testing analysis: 2026-11-07*
