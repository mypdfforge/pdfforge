---
last_mapped_commit: b21884f1c66d14e46e24dcca588d6fb591273045
last_mapped_at: 2026-11-07
---
# Codebase Structure

**Analysis Date:** 2026-11-07

## Directory Layout

```
pdfforge-main/
├── backend/                  # FastAPI Python backend application
│   ├── routes/               # API endpoint modules (upload, export, tools)
│   ├── services/             # Core backend services (safe_paths, fonts)
│   ├── limits.py             # Rate limiting and size guard middleware
│   ├── main.py               # FastAPI entry point & CORS configuration
│   └── requirements.txt      # Python dependencies
├── docx2pdf/                 # Rust WebAssembly OOXML-to-PDF conversion engine
│   ├── src/                  # Rust source files (lib.rs, parser, pdf generator)
│   ├── Cargo.toml            # Rust crate manifest and optimization profiles
│   └── compare_pdfs.mjs      # Node script for visual rendering diffs
├── frontend/                 # React 18 single page application (Vite)
│   ├── e2e/                  # Playwright / headless browser E2E test suites
│   ├── src/
│   │   ├── components/       # Reusable UI components (Sidebar, TopBar, DropZone)
│   │   ├── editor/           # Advanced in-browser PDF text editor & canvas
│   │   ├── features/         # Feature-specific modules (e.g. word-to-pdf)
│   │   ├── pages/            # Individual tool pages and dashboard views
│   │   ├── utils/            # Client conversion routines, API client, helpers
│   │   └── vendor/           # Compiled WASM assets and third-party binaries
│   ├── package.json          # Node dependencies and npm scripts
│   └── vite.config.js        # Vite bundler configuration
├── test_25pages_output.pdf   # 25-page multi-format QA stress benchmark document
├── GEMINI.md                 # Project operational guidelines & user confirmation rules
└── start.bat                 # Windows one-click local development launcher
```

## Directory Purposes

**`backend/`:**
- Purpose: High-speed server-side conversion, heavy PDF manipulation, and OCR processing.
- Key files: `backend/main.py`, `backend/routes/tools.py`, `backend/limits.py`, `backend/services/safe_paths.py`.

**`docx2pdf/`:**
- Purpose: Standalone Rust crate compiled to `docx2pdf_bg.wasm` enabling instant, client-side Word-to-PDF conversions with minimal overhead.
- Key files: `docx2pdf/Cargo.toml`, `docx2pdf/src/lib.rs`.

**`frontend/src/features/`:**
- Purpose: Modular self-contained domains combining UI, state management, capabilities probe, and engine hosts.
- Key files: `frontend/src/features/word-to-pdf/ui/WordToPdfTool.jsx`, `frontend/src/features/word-to-pdf/engine/engineHost.js`.

**`frontend/src/editor/`:**
- Purpose: In-browser PDF text block detection, interactive selection, font styling, reflow calculation, and export validation.
- Key files: `frontend/src/editor/EditorApp.tsx`, `frontend/src/editor/core/store.ts`, `frontend/src/editor/core/layout.ts`.

**`frontend/src/utils/`:**
- Purpose: Client-side file format converters, API networking, and DOM utilities.
- Key files: `frontend/src/utils/convertClient.js`, `frontend/src/utils/pdfToExcel.js`, `frontend/src/utils/api.js`.

## Key File Locations

**Entry Points:**
- Backend API: `backend/main.py`
- Frontend UI: `frontend/src/main.jsx` & `frontend/src/App.jsx`
- Rust WASM Lib: `docx2pdf/src/lib.rs`

**Configuration:**
- Frontend Bundler: `frontend/vite.config.js`
- Editor TypeScript: `frontend/src/editor/tsconfig.json`
- Rust Build Options: `docx2pdf/Cargo.toml`
- Deployment Manifest: `backend/render.yaml`

**Core Logic & Converters:**
- Backend Tools: `backend/routes/tools.py`
- Client Converters: `frontend/src/utils/convertClient.js`
- Safe Path Traversal: `backend/services/safe_paths.py`

## Naming Conventions

**Files:**
- React Components: PascalCase (`ToolPage.jsx`, `SmartUpload.jsx`, `CropCanvas.jsx`)
- Utility Modules: camelCase (`convertClient.js`, `safePaths.js`, `api.js`)
- Python Source: snake_case (`safe_paths.py`, `test_stress.py`, `limits.py`)
- Test Files: `*.test.ts`, `*.test.js`

**Directories:**
- Frontend: kebab-case or lowercase (`word-to-pdf`, `components`, `editor`, `utils`)
- Backend: lowercase (`routes`, `services`)

## Where to Add New Code

**Adding a New Document Conversion Tool:**
- UI & Options: Register in `frontend/src/utils/tools.js` and add route/view to `frontend/src/pages/ToolPage.jsx`.
- Client Logic: Implement conversion routine in `frontend/src/utils/convertClient.js`.
- Backend Route (if server-powered): Add new endpoint in `backend/routes/tools.py` using `safe_join` for temporary files.
- Tests: Add corresponding Vitest suite in `frontend/tests/` or Python test in `backend/`.

**Adding a Shared Component or Utility:**
- Shared UI Component: `frontend/src/components/`
- Helper Function: `frontend/src/utils/`

---

*Structure analysis: 2026-11-07*
