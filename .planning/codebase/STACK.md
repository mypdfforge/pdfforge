---
last_mapped_commit: b21884f1c66d14e46e24dcca588d6fb591273045
last_mapped_at: 2026-11-07
---
# Technology Stack

**Analysis Date:** 2026-11-07

## Languages

**Primary:**
- JavaScript (ES2022+ / JSX) - Frontend SPA implementation in `frontend/src/`
- TypeScript - Editor type definitions, interfaces, and geometry calculations in `frontend/src/editor/`
- Python 3.10+ - Backend API service and document processing pipelines in `backend/`

**Secondary:**
- Rust (2021 Edition) - High-performance WebAssembly document conversion engine in `docx2pdf/`
- HTML5 / CSS3 - UI components, styling, canvas drawing, and preview layouts

## Runtime

**Environment:**
- Node.js (v18+ / v20+) - Frontend build toolchain and local dev server
- Python 3.10 / 3.12 - Backend server runtime (`backend/.python-version` specifies 3.12)
- WebAssembly (Wasm) - Client-side in-browser execution (`frontend/src/vendor/docx2pdf/docx2pdf_bg.wasm`)

**Package Manager:**
- npm - Frontend package management (`frontend/package.json`, `frontend/package-lock.json`)
- pip - Python backend dependency management (`backend/requirements.txt`)
- cargo - Rust dependency management (`docx2pdf/Cargo.toml`, `docx2pdf/Cargo.lock`)

## Frameworks

**Core:**
- React 18.3.1 (`frontend/src/`) - UI framework for SPA
- FastAPI 0.111.0 (`backend/main.py`) - Asynchronous Python REST API
- Uvicorn 0.30.0 - ASGI web server for FastAPI

**Testing:**
- Vitest 2.1.8 - Frontend unit and integration tests (`frontend/tests/word-to-pdf`)
- Node Test Runner (`node --test`) - Editor geometry and extraction unit tests (`frontend/src/editor/__tests__`)
- Playwright / Chromium - End-to-end integration test runner (`frontend/e2e/`)
- Python unittest / benchmark scripts - Backend stress and capacity tests (`backend/test_stress.py`, `backend/test_max_capacity.py`)

**Build/Dev:**
- Vite 5.3.1 (`frontend/vite.config.js`) - Fast ESM bundler & HMR dev server
- wasm-pack / cargo - Rust WASM compilation target (`docx2pdf/`)

## Key Dependencies

**Critical:**
- `@cantoo/pdf-lib` (2.11.1) - In-browser PDF manipulation, splitting, merging, and page extraction
- `pdfjs-dist` (3.11.174) - PDF rendering, thumbnail generation, and text layer extraction
- `pymupdf` (1.27.2 / `fitz`) - Backend high-speed PDF manipulation, rendering, and text analysis
- `python-docx` (1.1.2) - Backend Word document generation and manipulation
- `docx` (9.12.0) - Client-side Word document creation
- `quick-xml` (0.31) & `pdf-writer` (0.9) - Rust OOXML parsing and low-level PDF stream writing

**Document & Media Processing:**
- `jspdf` (4.2.1) & `jspdf-autotable` (5.0.9) - PDF generation and table styling
- `exceljs` (4.4.0) & `xlsx` (0.18.5) - Spreadsheet parsing and Excel workbook creation
- `pptxgenjs` (4.0.1) & `python-pptx` (0.6.23) - PowerPoint slide deck generation
- `pytesseract` (0.3.10) & `Pillow` (10.4.0) - OCR text extraction and image rasterization
- `lucide-react` (0.383.0) - Consistent UI iconography

## Configuration

**Environment:**
- `ALLOWED_ORIGINS` - Configured in `backend/main.py` for CORS origin policies
- Local development default: `http://localhost:5173`

**Build:**
- `frontend/vite.config.js` - Vite bundling, alias definitions, and dev server proxy settings
- `frontend/src/editor/tsconfig.json` - TypeScript compiler flags for editor modules
- `docx2pdf/Cargo.toml` - Rust release profile (`opt-level = "z"`, `lto = "fat"`, `panic = "abort"`)

## Platform Requirements

**Development:**
- Windows / macOS / Linux with Node.js 18+, Python 3.10+, and Rust toolchain (optional, pre-built wasm present)
- Windows batch runner provided in `start.bat`

**Production:**
- Backend deployable on Render (`backend/render.yaml`, `backend/Procfile`) or Docker/Linux VMs
- Frontend deployable as static SPA (Vercel, Netlify, Cloudflare Pages, S3/CloudFront)

---

*Stack analysis: 2026-11-07*
