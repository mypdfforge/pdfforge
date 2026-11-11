---
last_mapped_commit: b21884f1c66d14e46e24dcca588d6fb591273045
last_mapped_at: 2026-11-07
---
<!-- refreshed: 2026-11-07 -->
# Architecture

**Analysis Date:** 2026-11-07

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                      Client Frontend SPA (React + Vite)                  │
├──────────────────┬──────────────────────┬───────────────────────────────┤
│    Dashboard     │  Document Editor     │   Dedicated Tool Pages        │
│ `pages/Dashboard`│ `editor/EditorApp`   │ `pages/ToolPage`, `features/` │
└────────┬─────────┴──────────┬───────────┴──────────────┬────────────────┘
         │                    │                          │
         ▼                    ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              Client-Side Conversion & Layout Engines                    │
│  • Rust WASM Engine: `frontend/src/vendor/docx2pdf/` (Docx to PDF)      │
│  • PDF Manipulation: `@cantoo/pdf-lib`, `jspdf`, `pdfjs-dist`          │
│  • Format Exporters: `exceljs`, `pptxgenjs`, `docx`                     │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │ Fallback / Heavy Processing
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              Backend REST API (FastAPI / Uvicorn)                       │
│  `backend/main.py` + `backend/limits.py`                                │
├──────────────────┬──────────────────────┬───────────────────────────────┤
│   Upload Router  │    Tools Router      │        Export Router          │
│ `routes/upload`  │  `routes/tools`      │       `routes/export`         │
└────────┬─────────┴──────────┬───────────┴──────────────┬────────────────┘
         │                    │                          │
         ▼                    ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          Backend High-Fidelity Conversion Pipeline                      │
│  • PyMuPDF (`fitz` 1.27): Fast rasterization, vector extraction, layout │
│  • Python Office Libraries: `python-docx`, `python-pptx`, `openpyxl`    │
│  • OCR Engine: `pytesseract` + `Pillow`                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
| :--- | :--- | :--- |
| `FastAPI Application` | API gateway, CORS policies, rate limiting, and routing | `backend/main.py` |
| `LimitsMiddleware` | IP rate-limiting and payload size safety protection | `backend/limits.py` |
| `Tools Router` | PDF split, merge, compress, watermark, rotate, stamp, redact, PDF-to-Word | `backend/routes/tools.py` |
| `Export Router` | In-place text modifications, Noto font embedding, PDF vector output | `backend/routes/export.py` |
| `Upload Router` | Ephemeral session-based file uploads and inspection | `backend/routes/upload.py` |
| `Safe Path Utilities` | Directory traversal prevention and secure file path joining | `backend/services/safe_paths.py` |
| `App Root` | Top-level SPA layout, hash/view navigation, and theme provider | `frontend/src/App.jsx` |
| `ToolPage` | Unified conversion runner for browser-based and server-based tools | `frontend/src/pages/ToolPage.jsx` |
| `ConvertClient` | Client-side converters for Word, Excel, PPTX, HTML, and Images | `frontend/src/utils/convertClient.js` |
| `Word-to-PDF Feature` | Modular Word-to-PDF UI, engine host, and probe diagnostics | `frontend/src/features/word-to-pdf/` |
| `docx2pdf WASM Engine`| Low-overhead Rust WebAssembly OOXML parser and PDF writer | `frontend/src/vendor/docx2pdf/` |
| `Document Editor` | Block-level text editing, geometry reflow, font matching, overlay canvas | `frontend/src/editor/` |

## Pattern Overview

**Overall:** Hybrid Dual-Engine Architecture (Client-Side First with Server Fallback)

**Key Characteristics:**
- **Zero-Latency In-Browser Processing:** Operations such as PDF splitting, page reordering, basic client-side conversions, and client text extractions execute directly inside the browser using WASM, Web Workers, and JS libraries without uploading user files over the wire.
- **Server Power Pipeline:** Complex layouts, scanned OCR, high-volume batch tasks, and font-sensitive operations leverage the high-performance FastAPI/PyMuPDF backend.
- **Stateless Operation:** Both frontend and backend avoid persistent databases; documents are processed in ephemeral buffers with strict cleanup guarantees.

## Layers

**UI Presentation Layer (`frontend/src/pages/`, `frontend/src/components/`):**
- Purpose: Render user controls, drag-and-drop file inputs, visual page sidebars, canvas previews, and progress indicators.
- Depends on: React, Lucide icons, client utility modules.

**Client Transformation Layer (`frontend/src/utils/convertClient.js`, `frontend/src/editor/`):**
- Purpose: Direct document AST generation, client-side canvas rasterization, and geometry tracking.
- Contains: `pdfToWord`, `pdfToExcel`, `pdfToPptx`, `wordToPdf`, editor state store.

**Backend Service Layer (`backend/routes/`):**
- Purpose: REST endpoints receiving multipart form files and delivering processed document streams (`application/pdf`, `.docx`, `.xlsx`, etc.).
- Contains: PyMuPDF document operations, python-docx generators, image processing.

**Security & Safety Layer (`backend/limits.py`, `backend/services/safe_paths.py`):**
- Purpose: Prevent resource exhaustion, enforce max payload limits, and sanitize path traversal attacks (`safe_join`).

## Data Flow

### PDF to Word Conversion Flow

1. **User Upload & Initiation:** User selects PDF file on `frontend/src/pages/ToolPage.jsx` or triggers `/tools/pdf-to-word` via `frontend/src/utils/api.js`.
2. **Backend Processing:**
   - `backend/routes/tools.py::pdf_to_word` accepts the multipart upload.
   - Saves file to secure temporary directory via `safe_join`.
   - Opens document with PyMuPDF `fitz.open()`.
   - First pass analyzes typography across all blocks to calculate median body font size and heading thresholds.
   - Second pass extracts text blocks, spans, bullet patterns (`BULLET_RE`), font sizes, weights, and paragraph alignments.
   - Generates formatted `.docx` using `python-docx` with 1-inch margins and page breaks.
3. **Response & Delivery:** Endpoint returns `FileResponse` containing `converted.docx` directly to the client browser.

### Word to PDF Conversion Flow (Hybrid)

1. **Primary Route (Client WASM):** `frontend/src/utils/convertClient.js` invokes `docx2pdfClient.js`, running `frontend/src/vendor/docx2pdf/docx2pdf_bg.wasm` entirely inside the browser.
2. **Secondary Route (OOXML AST):** If WASM is unavailable or encounters unsupported elements, falls back to direct OOXML parsing with jsPDF and html2canvas.

## Architectural Constraints

- **Single-Threaded WASM Ceiling:** In-browser WASM engine operates within browser tab memory bounds (must handle large documents without out-of-memory crashes).
- **Zero-Storage Retention:** All backend files are written to temporary scratch folders and cleaned up after HTTP transmission.
- **CORS Isolation:** Only explicitly whitelisted frontend origins can access backend endpoints.

---

*Architecture analysis: 2026-11-07*
