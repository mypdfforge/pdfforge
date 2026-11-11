---
last_mapped_commit: b21884f1c66d14e46e24dcca588d6fb591273045
last_mapped_at: 2026-11-07
---
# Codebase Concerns

**Analysis Date:** 2026-11-07

## Tech Debt

**Dual Implementation of Converters:**
- Issue: Conversion logic exists in both client-side JavaScript (`frontend/src/utils/convertClient.js`) and backend Python (`backend/routes/tools.py`), with divergent fidelity levels.
- Files: `frontend/src/utils/convertClient.js`, `backend/routes/tools.py`
- Impact: Inconsistent user experience depending on whether an action runs locally in the browser or hits the server.
- Fix approach: Unify engine selection with automated capability sniffing (e.g., lightweight files process in-browser via WASM, complex/stress layouts route to server).

**Ad-Hoc Font Retrieval:**
- Issue: `backend/routes/export.py` attempts runtime URL downloads from Google Fonts CDN (`urllib.request.urlretrieve`) if NotoSans fonts are absent.
- Files: `backend/routes/export.py`
- Impact: Potential network latency or failure in air-gapped / offline deployments.
- Fix approach: Package required core font assets directly inside the repository or Docker container image.

## Known Edge Cases & Conversion Gaps

**Complex Document Structures (25-Page Benchmark Matrix):**
- Symptoms: When converting rich PDFs to Word:
  - Tables with merged headers or variable-width cells may collapse into plain paragraphs.
  - Right-to-Left (RTL) scripts (Arabic, Hebrew) and Devanagari conjuncts can experience glyph reversal or disconnected ligatures if the Word generator lacks complex text shaping.
  - Multi-column editorial sections can lose column ordering and interleave sentences.
  - Long unbroken strings (such as deep URLs or Base64 hashes) risk clipping page margins.
- Files: `backend/routes/tools.py` (`pdf_to_word`), `frontend/src/utils/convertClient.js` (`pdfToWord`)
- Trigger: Processing complex synthetic stress documents (such as `test_25pages_output.pdf`).
- Fix approach: Incorporate advanced cell coordinate clustering, RTL layout detection (`python-bidi` / HarfBuzz / Uniscribe shaping where needed), and table-structure reconstruction algorithms.

## Security Considerations

**Memory Limits & Denial of Service:**
- Risk: Processing extremely high-DPI bitmaps (1200+ DPI), decompression bombs, or deeply nested PDF vector structures can spike worker memory.
- Files: `backend/routes/tools.py`, `backend/limits.py`
- Current mitigation: Basic rate limiting in `LimitsMiddleware`.
- Recommendations: Set strict memory limits on PyMuPDF worker processes and enforce file size / page count limits upfront.

**Sanitization of Extracted Text:**
- Risk: Illegal XML characters crashing Word/Excel parsers upon document generation.
- Files: `backend/routes/tools.py`
- Current mitigation: Regex filtering illegal XML characters (`XML_ILLEGAL_RE.sub("", line_text)`).
- Recommendations: Maintain comprehensive XML escaping across all client and server exporters.

## Performance Bottlenecks

**Progressive Thumbnail Generation for Massive Documents:**
- Problem: Generating high-resolution previews for 100+ page documents blocks the main thread or causes browser UI sluggishness.
- Files: `frontend/src/utils/thumbnailCache.js`, `backend/routes/tools.py::get_thumbnails`
- Improvement path: Leverage Web Workers with offscreen canvas and progressive downsampling.

## Test Coverage Gaps

**PDF-to-Word High-Fidelity Verification:**
- What's not tested: Automated SSIM and text extraction round-trip verification across all 25 benchmark sections of `test_25pages_output.pdf`.
- Files: `backend/routes/tools.py`, `frontend/src/utils/convertClient.js`
- Priority: High.

---

*Concerns audit: 2026-11-07*
